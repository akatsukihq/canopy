import { cache } from "react";
import { z } from "zod";

import { db, isDatabaseConfigured, platformSettingsTable } from "../../db/index.ts";
import config from "./config.ts";
import { decryptSecret } from "./secrets.ts";

/** A provider model id: letters, digits and `.:_-/`. Picked from the provider's own model list in Admin. */
const modelSchema = z
  .string()
  .trim()
  .regex(/^[\w.:/-]{1,100}$/);
const secretSchema = z.string().trim().min(1).max(500).regex(/^\S+$/, "Keys cannot contain spaces.");
const plainText = (max: number) => z.string().trim().max(max);
const emailOrEmpty = z.union([z.literal(""), z.email().max(254)]);

export type RuntimeSettingSection = "ai" | "email" | "uploads" | "integrations" | "traffic" | "site";
/** @deprecated name kept for existing imports; same as RuntimeSettingSection. */
export type RuntimeSettingGroup = RuntimeSettingSection;
type Definition = {
  group: RuntimeSettingSection;
  label: string;
  description: string;
  /**
   * How the Admin form edits it. `secret` values are encrypted at rest and never
   * sent to the browser; `model` lists models from the provider named by `provider`.
   */
  kind: "boolean" | "choice" | "number" | "text" | "secret" | "model";
  schema: z.ZodType<RuntimeSettingValue>;
  options?: readonly string[];
  provider?: "openai" | "anthropic" | "compatible";
  /** Shown beside a number input. */
  unit?: string;
  /** Text inputs: browser keyboard and validation hint. */
  format?: "email" | "plain";
  /** Environment or code default, used when no valid override is stored. */
  env: () => RuntimeSettingValue;
};

const env = (name: string) => process.env[name]?.trim() ?? "";

/** Defaults for settings that have no environment variable. */
export const TOOL_REQUESTS_PER_MINUTE = 20;
export const CODE_RUNS_PER_MINUTE = 10;

/**
 * Settings Admin may override. Each is read per request (nothing read at
 * startup or baked into stored data), numbers are bounded so a bad value cannot
 * remove a safety cap, and secrets are encrypted at rest.
 */
export const RUNTIME_SETTINGS = {
  "ai.enabled": {
    group: "ai",
    kind: "boolean",
    label: "AI assistant",
    description:
      "Turns the AI assistant on or off for blog and tool admin. Without an API key for the active provider it stays unavailable.",
    schema: z.boolean(),
    env: () => config.ai.enabled,
  },
  "ai.provider": {
    group: "ai",
    kind: "choice",
    label: "Active provider",
    description: "Provider used for new assistant runs. Existing conversations keep the provider they started with.",
    schema: z.enum(["openai", "anthropic", "compatible"]),
    options: ["openai", "anthropic", "compatible"],
    env: () => config.ai.provider,
  },
  "ai.openai.apiKey": {
    group: "ai",
    kind: "secret",
    label: "API key",
    description: "OpenAI API key. Stored encrypted; never shown again after saving.",
    schema: secretSchema,
    env: () => config.ai.openai.apiKey?.trim() ?? "",
  },
  "ai.openaiModel": {
    group: "ai",
    kind: "model",
    provider: "openai",
    label: "Chat model",
    description: "Model for assistant runs.",
    schema: modelSchema,
    env: () => config.ai.openai.model,
  },
  "ai.titleModel": {
    group: "ai",
    kind: "model",
    provider: "openai",
    label: "Title model",
    description: "Model that writes short titles for blog briefs. A small, fast model is enough.",
    schema: modelSchema,
    env: () => config.ai.titleModel,
  },
  "ai.anthropic.apiKey": {
    group: "ai",
    kind: "secret",
    label: "API key",
    description: "Anthropic API key. Stored encrypted; never shown again after saving.",
    schema: secretSchema,
    env: () => env("ANTHROPIC_API_KEY"),
  },
  "ai.anthropicModel": {
    group: "ai",
    kind: "model",
    provider: "anthropic",
    label: "Chat model",
    description: "Model for assistant runs.",
    schema: modelSchema,
    env: () => env("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
  },
  "ai.anthropicTitleModel": {
    group: "ai",
    kind: "model",
    provider: "anthropic",
    label: "Title model",
    description: "Model that writes short titles for blog briefs. A small, fast model is enough.",
    schema: modelSchema,
    env: () => env("ANTHROPIC_TITLE_MODEL") || env("ANTHROPIC_MODEL") || "claude-haiku-5-5",
  },
  "ai.compatible.baseUrl": {
    group: "ai",
    kind: "text",
    format: "plain",
    label: "Base URL",
    description: "OpenAI-compatible API root, for example https://openrouter.ai/api/v1 or http://localhost:11434/v1.",
    schema: plainText(500).refine(
      (value) => value === "" || (/^https?:\/\/\S+$/.test(value) && URL.canParse(value)),
      "Enter an http(s) URL, such as https://api.example.com/v1.",
    ),
    env: () => env("OPENAI_COMPATIBLE_BASE_URL"),
  },
  "ai.compatible.apiKey": {
    group: "ai",
    kind: "secret",
    label: "API key",
    description: "Optional: leave empty for endpoints that need no key, such as a local server.",
    schema: secretSchema,
    env: () => env("OPENAI_COMPATIBLE_API_KEY"),
  },
  "ai.compatibleModel": {
    group: "ai",
    kind: "model",
    provider: "compatible",
    label: "Chat model",
    description: "Model for assistant runs.",
    schema: modelSchema,
    env: () => env("OPENAI_COMPATIBLE_MODEL"),
  },
  "ai.compatibleTitleModel": {
    group: "ai",
    kind: "model",
    provider: "compatible",
    label: "Title model",
    description: "Model that writes short titles for blog briefs. A small, fast model is enough.",
    schema: modelSchema,
    env: () => env("OPENAI_COMPATIBLE_TITLE_MODEL") || env("OPENAI_COMPATIBLE_MODEL"),
  },
  "email.provider": {
    group: "email",
    kind: "choice",
    label: "Active provider",
    description: "Provider that sends sign-in and account emails. Send a test email before switching.",
    schema: z.enum(["cloudflare", "resend", "smtp"]),
    options: ["cloudflare", "resend", "smtp"],
    env: () => config.email.provider,
  },
  "email.accountsFrom": {
    group: "email",
    kind: "text",
    format: "email",
    label: "From address",
    description: "Sender of sign-in and account emails. Must be a domain the active provider is allowed to send from.",
    schema: emailOrEmpty,
    env: () => config.email.accountsEmail?.trim() ?? "",
  },
  "email.cloudflare.accountId": {
    group: "email",
    kind: "text",
    format: "plain",
    label: "Account ID",
    description: "Cloudflare account that owns Email Sending.",
    schema: plainText(64).regex(/^[a-zA-Z0-9]*$/, "Use the account ID from the Cloudflare dashboard."),
    env: () => config.email.accountId?.trim() ?? "",
  },
  "email.cloudflare.apiToken": {
    group: "email",
    kind: "secret",
    label: "API token",
    description: "Cloudflare API token with Email Sending permission.",
    schema: secretSchema,
    env: () => config.email.apiToken?.trim() ?? "",
  },
  "email.resend.apiKey": {
    group: "email",
    kind: "secret",
    label: "API key",
    description: "Resend API key with sending access.",
    schema: secretSchema,
    env: () => env("RESEND_API_KEY"),
  },
  "email.smtp.host": {
    group: "email",
    kind: "text",
    format: "plain",
    label: "Host",
    description: "SMTP server name, for example smtp.example.com.",
    schema: plainText(253).regex(/^[a-zA-Z0-9.-]*$/, "Enter a host name without a scheme or port."),
    env: () => env("SMTP_HOST"),
  },
  "email.smtp.port": {
    group: "email",
    kind: "number",
    label: "Port",
    description: "Usually 587 (STARTTLS) or 465 (TLS).",
    schema: z.number().int().min(1).max(65535),
    env: () => Number(env("SMTP_PORT")) || 587,
  },
  "email.smtp.secure": {
    group: "email",
    kind: "boolean",
    label: "TLS from the start",
    description: "On for port 465. Off uses STARTTLS on 587.",
    schema: z.boolean(),
    env: () => env("SMTP_SECURE") === "true",
  },
  "email.smtp.user": {
    group: "email",
    kind: "text",
    format: "plain",
    label: "Username",
    description: "SMTP login name.",
    schema: plainText(254),
    env: () => env("SMTP_USER"),
  },
  "email.smtp.password": {
    group: "email",
    kind: "secret",
    label: "Password",
    description: "SMTP password or app password.",
    schema: z.string().min(1).max(500),
    env: () => env("SMTP_PASSWORD"),
  },
  "uploads.cloudinary.apiKey": {
    group: "uploads",
    kind: "text",
    format: "plain",
    label: "API key",
    description:
      "Cloudinary API key for blog images and tool icons. The cloud name stays in the environment because stored images point at it.",
    schema: plainText(64).regex(/^[0-9]*$/, "Cloudinary API keys are digits."),
    env: () => config.cloudinary.apiKey?.trim() ?? "",
  },
  "uploads.cloudinary.apiSecret": {
    group: "uploads",
    kind: "secret",
    label: "API secret",
    description: "Cloudinary API secret. Changing it cancels uploads that are in progress.",
    schema: secretSchema,
    env: () => config.cloudinary.apiSecret?.trim() ?? "",
  },
  "integrations.ahrefs.apiKey": {
    group: "integrations",
    kind: "secret",
    label: "Ahrefs API key",
    description: "Used by the Domain Rating Checker tool.",
    schema: secretSchema,
    env: () => config.integrations.ahrefsApiKey?.trim() ?? "",
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
    format: "email",
    label: "Support email",
    description: 'Address shown on the Contact page. Leave empty to show the "email unavailable" message.',
    schema: emailOrEmpty,
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
    const raw = stored.get(key);
    const plain = definition.kind === "secret" ? decryptSecret(raw, key) : raw;
    const parsed = stored.has(key) && plain !== null ? definition.schema.safeParse(plain) : undefined;
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

/**
 * Switchable providers. Each keeps its own saved settings; Admin makes one active
 * with a separate confirmed click, allowed only when every `required` setting has a value.
 */
export const PROVIDER_CHOICES = {
  "ai.provider": {
    openai: { label: "OpenAI", required: ["ai.openai.apiKey", "ai.openaiModel", "ai.titleModel"] },
    anthropic: { label: "Anthropic", required: ["ai.anthropic.apiKey", "ai.anthropicModel", "ai.anthropicTitleModel"] },
    compatible: {
      label: "OpenAI-compatible",
      required: ["ai.compatible.baseUrl", "ai.compatibleModel", "ai.compatibleTitleModel"],
    },
  },
  "email.provider": {
    cloudflare: {
      label: "Cloudflare",
      required: ["email.accountsFrom", "email.cloudflare.accountId", "email.cloudflare.apiToken"],
    },
    resend: { label: "Resend", required: ["email.accountsFrom", "email.resend.apiKey"] },
    smtp: {
      label: "SMTP",
      required: ["email.accountsFrom", "email.smtp.host", "email.smtp.port", "email.smtp.user", "email.smtp.password"],
    },
  },
} as const satisfies Partial<
  Record<RuntimeSettingKey, Record<string, { label: string; required: readonly RuntimeSettingKey[] }>>
>;

export type ProviderSettingKey = keyof typeof PROVIDER_CHOICES;

export function isProviderSettingKey(key: unknown): key is ProviderSettingKey {
  return typeof key === "string" && Object.hasOwn(PROVIDER_CHOICES, key);
}

/** Settings of `provider` that still have no value; empty means it can be made active. */
export function missingProviderSettings(
  settings: RuntimeSettings,
  key: ProviderSettingKey,
  provider: string,
): RuntimeSettingKey[] {
  const choices: Record<string, { required: readonly RuntimeSettingKey[] }> = PROVIDER_CHOICES[key];
  const choice = choices[provider];
  if (!choice) return [];
  return choice.required.filter((required) => {
    const value = settings[required].value;
    return value === "" || value === undefined;
  });
}
