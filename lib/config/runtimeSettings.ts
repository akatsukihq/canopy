import { cache } from "react";
import { z } from "zod";

import { db, isDatabaseConfigured, platformSettingsTable } from "../../db/index.ts";
import config from "./config.ts";

/**
 * Chat models an admin may pick. A fixed list, so a typo cannot break AI calls.
 * The env value is always accepted as the default even if it is not listed.
 */
// Only model IDs this codebase already runs. Add one here after confirming the provider serves it:
// an unknown ID would make every AI call fail.
export const OPENAI_MODELS = ["gpt-5.6-terra"] as const;

const modelSchema = z.enum(OPENAI_MODELS);

/**
 * Settings Admin may override. Each is safe to change live: no secrets, no
 * traffic-routing URLs, nothing read at startup. Env stays the default.
 */
export const RUNTIME_SETTINGS = {
  "ai.enabled": {
    label: "AI assistant",
    description:
      "Turns the AI assistant on or off. Switching it on without an API key configured is harmless: the assistant stays unavailable.",
    schema: z.boolean(),
    env: () => config.ai.enabled,
  },
  "ai.openaiModel": {
    label: "Assistant model",
    description: "OpenAI model used for assistant runs.",
    schema: modelSchema,
    options: OPENAI_MODELS,
    env: () => config.ai.openai.model,
  },
  "ai.titleModel": {
    label: "Title model",
    description: "OpenAI model that writes short titles for blog briefs.",
    schema: modelSchema,
    options: OPENAI_MODELS,
    env: () => config.ai.titleModel,
  },
} as const;

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTINGS;
export type RuntimeSettingValue = boolean | string;
export type RuntimeSettingState = {
  value: RuntimeSettingValue;
  source: "env" | "admin";
  envValue: RuntimeSettingValue;
};
export type RuntimeSettings = Record<RuntimeSettingKey, RuntimeSettingState>;

export function isRuntimeSettingKey(key: unknown): key is RuntimeSettingKey {
  return typeof key === "string" && Object.hasOwn(RUNTIME_SETTINGS, key);
}

/** Pure: stored overrides win when they still pass the schema, otherwise env applies. */
export function resolveRuntimeSettings(stored: ReadonlyMap<string, unknown>): RuntimeSettings {
  const entries = (Object.keys(RUNTIME_SETTINGS) as RuntimeSettingKey[]).map((key) => {
    const definition = RUNTIME_SETTINGS[key];
    const envValue: RuntimeSettingValue = definition.env();
    const parsed = stored.has(key) ? definition.schema.safeParse(stored.get(key)) : undefined;
    const state: RuntimeSettingState = parsed?.success
      ? { value: parsed.data, source: "admin", envValue }
      : { value: envValue, source: "env", envValue };
    return [key, state] as const;
  });
  return Object.fromEntries(entries) as RuntimeSettings;
}

/** One database read per request; admin edits apply on the next request. Falls back to env. */
export const loadRuntimeSettings = cache(async (): Promise<RuntimeSettings> => {
  if (!isDatabaseConfigured()) return resolveRuntimeSettings(new Map());
  try {
    const rows = await db
      .select({ key: platformSettingsTable.key, value: platformSettingsTable.value })
      .from(platformSettingsTable);
    return resolveRuntimeSettings(new Map(rows.map((row) => [row.key, row.value])));
  } catch (error) {
    console.error("Runtime settings unavailable; using environment defaults.", error);
    return resolveRuntimeSettings(new Map());
  }
});
