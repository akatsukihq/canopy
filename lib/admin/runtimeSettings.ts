/** Admin edits to `platform_settings`: overrides for the runtime-settings allowlist. */
import { db, eq, platformSettingsTable } from "../../db/index.ts";
import {
  PROVIDER_CHOICES,
  RUNTIME_SETTINGS,
  isProviderSettingKey,
  isRuntimeSettingKey,
  loadRuntimeSettings,
  missingProviderSettings,
  type RuntimeSettingGroup,
  type RuntimeSettingValue,
} from "../config/runtimeSettings.ts";
import { SecretsUnavailableError, encryptSecret } from "../config/secrets.ts";
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

function invalidMessage(key: keyof typeof RUNTIME_SETTINGS, custom?: string): string {
  const definition: { kind: string; description: string; format?: string } = RUNTIME_SETTINGS[key];
  if (definition.kind === "number") return `Enter a whole number. ${definition.description.split(". ").pop()}`;
  if (definition.kind === "boolean") return "Choose on or off.";
  if (definition.kind === "secret") return custom ?? "Paste the key exactly as the provider shows it.";
  if (definition.kind === "model") return "Choose a model from the list.";
  if (definition.kind === "text")
    return definition.format === "email"
      ? "Enter a valid email address, or leave it empty."
      : (custom ?? "Check this value.");
  return "Choose one of the listed values.";
}

/** Zod's own message only when the schema set a readable one. */
const customMessage = (error: { issues: { code: string; message: string }[] }) =>
  error.issues.find((issue) => issue.code === "custom" || issue.code === "invalid_format")?.message;

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
    if (!parsed.success) throw new RuntimeSettingValueError(invalidMessage(key, customMessage(parsed.error)), key);
    next = parsed.data;
    if (definition.kind === "secret") {
      try {
        next = encryptSecret(String(next), key);
      } catch (error) {
        if (error instanceof SecretsUnavailableError) throw new RuntimeSettingValueError(error.message, key);
        throw error;
      }
    }
  }
  const secret = RUNTIME_SETTINGS[key].kind === "secret";
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
  // Secrets are recorded as changed, never by value (not even encrypted).
  await writeAudit(transaction, actorUserId, "platform-setting.edit", "platform-setting", key, {
    from: secret ? (current ? "[secret]" : null) : (current?.value ?? null),
    to: secret ? (next === null ? null : "[secret]") : next,
  });
}

/** Makes `provider` the active one for `key`, only when all its required settings have values. */
export async function activateProvider(actorUserId: string, key: string, provider: string): Promise<void> {
  if (!isProviderSettingKey(key)) throw new Error(`${key} is not a provider choice.`);
  const choices: Record<string, { label: string }> = PROVIDER_CHOICES[key];
  if (!Object.hasOwn(choices, provider)) throw new Error("Unknown provider.");
  await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "settings", "edit");
    const missing = missingProviderSettings(await loadRuntimeSettings(), key, provider);
    if (missing.length) {
      const labels = missing.map((name) => RUNTIME_SETTINGS[name].label.toLowerCase()).join(", ");
      throw new RuntimeSettingValueError(
        `${choices[provider].label} is not configured yet: add the ${labels} first.`,
        key,
      );
    }
    await applyRuntimeSetting(transaction, actorUserId, key, provider);
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
  kind: "boolean" | "choice" | "number" | "text" | "secret" | "model";
  options: string[];
  unit?: string;
  format?: "email" | "plain";
  provider?: "openai" | "anthropic" | "compatible";
  /** Always "" for secrets: their values never leave the server. */
  value: RuntimeSettingValue;
  /** For secrets, "set" or "" instead of the value. */
  envValue: RuntimeSettingValue;
  source: "env" | "admin";
  /** Secrets only: whether a value applies (saved here or from the environment). */
  secretSet?: boolean;
};

/** Serialisable props for `RuntimeSettingsCard`. */
export async function getRuntimeSettingsCardProps(canEdit: boolean) {
  const effective = await loadRuntimeSettings();
  const settings: RuntimeSettingView[] = Object.entries(RUNTIME_SETTINGS).map(([key, entry]) => {
    const definition: {
      group: RuntimeSettingGroup;
      label: string;
      description: string;
      kind: RuntimeSettingView["kind"];
      options?: readonly string[];
      unit?: string;
      format?: "email" | "plain";
      provider?: "openai" | "anthropic" | "compatible";
    } = entry;
    const state = effective[key as keyof typeof effective];
    const secret = definition.kind === "secret";
    const options: string[] = [...(definition.options ?? [])];
    return {
      key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      unit: definition.unit,
      format: definition.format,
      provider: definition.provider,
      // The env default may be unlisted; show it so the select can display it.
      options: options.length && !options.includes(String(state.value)) ? [String(state.value), ...options] : options,
      value: secret ? "" : state.value,
      envValue: secret ? (state.envValue ? "set" : "") : state.envValue,
      source: state.source,
      ...(secret ? { secretSet: Boolean(state.value) } : {}),
    };
  });
  return { settings, canEdit };
}
