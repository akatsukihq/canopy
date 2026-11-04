/** Admin edits to `platform_settings`: overrides for the runtime-settings allowlist. */
import { db, eq, platformSettingsTable } from "../../db/index.ts";
import { RUNTIME_SETTINGS, isRuntimeSettingKey, loadRuntimeSettings } from "../config/runtimeSettings.ts";
import { requireTransactionPermission, writeAudit } from "./adminMutations.ts";

/** A rejected value, shown beside the field. */
export class RuntimeSettingValueError extends Error {}

/** Save an override, or pass `null` to clear it and fall back to the environment value. */
export async function updateRuntimeSetting(actorUserId: string, key: string, value: unknown | null): Promise<void> {
  await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "settings", "edit");
    if (!isRuntimeSettingKey(key)) throw new Error(`${key} cannot be changed here.`);
    let next: unknown = null;
    if (value !== null) {
      const parsed = RUNTIME_SETTINGS[key].schema.safeParse(value);
      if (!parsed.success) throw new RuntimeSettingValueError("Choose one of the listed values.");
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
  });
}

export type RuntimeSettingView = {
  key: string;
  label: string;
  description: string;
  kind: "boolean" | "choice";
  options: string[];
  value: boolean | string;
  envValue: boolean | string;
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
      label: definition.label,
      description: definition.description,
      kind: options.length ? "choice" : "boolean",
      // The env default may be unlisted; show it so the select can display it.
      options: options.length && !options.includes(String(state.value)) ? [String(state.value), ...options] : options,
      value: state.value,
      envValue: state.envValue,
      source: state.source,
    };
  });
  return { settings, canEdit };
}
