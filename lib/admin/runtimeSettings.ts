/** Admin edits to `platform_settings`: overrides for the runtime-settings allowlist. */
import { db, eq, platformSettingsTable } from "../../db/index.ts";
import {
  RUNTIME_SETTINGS,
  isRuntimeSettingKey,
  loadRuntimeSettings,
  type RuntimeSettingGroup,
  type RuntimeSettingValue,
} from "../config/runtimeSettings.ts";
import { CACHE_NAMESPACES } from "../cache/index.ts";
import { invalidateAfterCommit, requireTransactionPermission, writeAudit, type Transaction } from "./adminMutations.ts";
import { applySystemLimit } from "./systemLimits.ts";

/** A rejected value, shown beside the field named by `key`. */
export class RuntimeSettingValueError extends Error {
  constructor(
    message: string,
    readonly key = "",
  ) {
    super(message);
  }
}

function invalidMessage(key: keyof typeof RUNTIME_SETTINGS): string {
  const definition = RUNTIME_SETTINGS[key];
  if (definition.kind === "number") return `Enter a whole number. ${definition.description.split(". ").pop()}`;
  if (definition.kind === "text") return "Enter a valid email address, or leave it empty.";
  if (definition.kind === "boolean") return "Choose on or off.";
  return "Choose one of the listed values.";
}

/** Save an override, or pass `null` to clear it and fall back to the environment value. */
export async function updateRuntimeSetting(actorUserId: string, key: string, value: unknown | null): Promise<void> {
  await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "settings", "edit");
    await applyRuntimeSetting(transaction, actorUserId, key, value);
  });
}

/** Validates and writes one override inside the caller's transaction; the caller checks `settings.edit`. */
export async function applyRuntimeSetting(
  transaction: Transaction,
  actorUserId: string,
  key: string,
  value: unknown | null,
): Promise<void> {
  if (!isRuntimeSettingKey(key)) throw new Error(`${key} cannot be changed here.`);
  let next: unknown = null;
  if (value !== null) {
    const definition = RUNTIME_SETTINGS[key];
    // Forms post strings; numbers and text are normalised here so every caller gets the same rules.
    const input =
      typeof value !== "string"
        ? value
        : definition.kind === "number"
          ? value.trim() === ""
            ? Number.NaN
            : Number(value)
          : definition.kind === "text"
            ? value.trim()
            : value;
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) throw new RuntimeSettingValueError(invalidMessage(key), key);
    next = parsed.data;
  }
  const [current] = await transaction
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key))
    .limit(1)
    .for("update");
  if (next === null) {
    await transaction.delete(platformSettingsTable).where(eq(platformSettingsTable.key, key));
  } else {
    await transaction
      .insert(platformSettingsTable)
      .values({ key, value: next, updatedBy: actorUserId })
      .onConflictDoUpdate({
        target: platformSettingsTable.key,
        set: { value: next, updatedAt: new Date(), updatedBy: actorUserId },
      });
  }
  await writeAudit(transaction, actorUserId, "platform-setting.edit", "platform-setting", key, {
    from: current?.value ?? null,
    to: next,
  });
}

/** Everything one Settings page changed, saved together or not at all. */
export type SettingsChanges = {
  limits: { key: string; value: unknown; updatedAt: unknown }[];
  runtime: { key: string; value: unknown | null }[];
};

export async function saveSettings(actorUserId: string, changes: SettingsChanges): Promise<void> {
  await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "settings", "edit");
    for (const change of changes.limits) await applySystemLimit(transaction, actorUserId, change.key, change);
    for (const change of changes.runtime) await applyRuntimeSetting(transaction, actorUserId, change.key, change.value);
  });
  // Public specs are clamped when the catalog loads, so cached copies must go.
  if (changes.limits.length) await invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, undefined);
}

export type RuntimeSettingView = {
  key: string;
  group: RuntimeSettingGroup;
  label: string;
  description: string;
  kind: "boolean" | "choice" | "number" | "text";
  options: string[];
  unit?: string;
  value: RuntimeSettingValue;
  envValue: RuntimeSettingValue;
  source: "env" | "admin";
};

/** Serialisable props for `RuntimeSettingsCard`. */
export async function getRuntimeSettingsCardProps(canEdit: boolean) {
  const effective = await loadRuntimeSettings();
  const settings: RuntimeSettingView[] = Object.entries(RUNTIME_SETTINGS).map(([key, definition]) => {
    const state = effective[key as keyof typeof effective];
    const options: string[] = "options" in definition ? [...definition.options] : [];
    return {
      key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      unit: "unit" in definition ? definition.unit : undefined,
      // The env default may be unlisted; show it so the select can display it.
      options: options.length && !options.includes(String(state.value)) ? [String(state.value), ...options] : options,
      value: state.value,
      envValue: state.envValue,
      source: state.source,
    };
  });
  return { settings, canEdit };
}
