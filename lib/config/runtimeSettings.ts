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

export type RuntimeSettingGroup = "ai" | "traffic" | "site";
type Definition = {
  group: RuntimeSettingGroup;
  label: string;
  description: string;
  /** How the Admin form edits it. */
  kind: "boolean" | "choice" | "number" | "text";
  schema: z.ZodType<RuntimeSettingValue>;
  options?: readonly string[];
  /** Shown beside a number input. */
  unit?: string;
  /** Environment or code default, used when no valid override is stored. */
  env: () => RuntimeSettingValue;
};

/** Defaults for settings that have no environment variable. */
export const TOOL_REQUESTS_PER_MINUTE = 20;
export const CODE_RUNS_PER_MINUTE = 10;

/**
 * Settings Admin may override. Each is safe to change live: no secrets, no
 * traffic-routing URLs, nothing read at startup, and numbers are bounded so a
 * bad value cannot lock visitors out or remove a safety cap.
 */
export const RUNTIME_SETTINGS = {
  "ai.enabled": {
    group: "ai",
    kind: "boolean",
    label: "AI assistant",
    description:
      "Turns the AI assistant on or off for blog and tool admin. Without an API key it stays unavailable either way.",
    schema: z.boolean(),
    env: () => config.ai.enabled,
  },
  "ai.openaiModel": {
    group: "ai",
    kind: "choice",
    label: "Assistant model",
    description: "OpenAI model used for assistant runs.",
    schema: modelSchema,
    options: OPENAI_MODELS,
    env: () => config.ai.openai.model,
  },
  "ai.titleModel": {
    group: "ai",
    kind: "choice",
    label: "Title model",
    description: "OpenAI model that writes short titles for blog briefs.",
    schema: modelSchema,
    options: OPENAI_MODELS,
    env: () => config.ai.titleModel,
  },
  "traffic.toolRequestsPerMinute": {
    group: "traffic",
    kind: "number",
    label: "Tool API requests",
    description: "Requests one visitor may send to one server-side tool each minute. Allowed range 1 to 120.",
    schema: z.number().int().min(1).max(120),
    unit: "per minute",
    env: () => TOOL_REQUESTS_PER_MINUTE,
  },
  "traffic.codeRunsPerMinute": {
    group: "traffic",
    kind: "number",
    label: "Code runs",
    description: "Code executions one visitor may start each minute across all code runners. Allowed range 1 to 60.",
    schema: z.number().int().min(1).max(60),
    unit: "per minute",
    env: () => CODE_RUNS_PER_MINUTE,
  },
  "site.supportEmail": {
    group: "site",
    kind: "text",
    label: "Support email",
    description: 'Address shown on the Contact page. Leave empty to show the "email unavailable" message.',
    schema: z.union([z.literal(""), z.email().max(254)]),
    env: () => config.email.supportEmail?.trim() ?? "",
  },
} as const satisfies Record<string, Definition>;

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTINGS;
export type RuntimeSettingValue = boolean | string | number;
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
    const definition: Definition = RUNTIME_SETTINGS[key];
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
