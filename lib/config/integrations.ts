/**
 * Server-only: provider credentials from runtime settings (Admin override,
 * else environment). Values here include decrypted secrets, so never pass
 * them to client components or logs.
 */
import "server-only";
import { AIClient } from "../ai/client.ts";
import type { EmailConfig, EmailProvider } from "../email/sender.ts";
import config from "./config.ts";
import { loadRuntimeSettings, type RuntimeSettings } from "./runtimeSettings.ts";

const text = (settings: RuntimeSettings, key: keyof RuntimeSettings) => String(settings[key].value ?? "").trim();

export type AIProviderName = "openai" | "anthropic";

export function aiCredentials(settings: RuntimeSettings, provider: AIProviderName) {
  return provider === "anthropic"
    ? {
        apiKey: text(settings, "ai.anthropic.apiKey"),
        chatModel: text(settings, "ai.anthropicModel"),
        titleModel: text(settings, "ai.anthropicTitleModel"),
      }
    : {
        apiKey: text(settings, "ai.openai.apiKey"),
        chatModel: text(settings, "ai.openaiModel"),
        titleModel: text(settings, "ai.titleModel"),
      };
}

export function activeAIProvider(settings: RuntimeSettings): AIProviderName {
  return settings["ai.provider"].value === "anthropic" ? "anthropic" : "openai";
}

/**
 * An AI client with the runtime key and model. `provider` defaults to the active
 * one; pass a stored name to reach a past run's or file's provider.
 */
export async function createAIClient(provider?: string, purpose: "chat" | "title" = "chat"): Promise<AIClient> {
  const settings = await loadRuntimeSettings();
  const name = provider ?? activeAIProvider(settings);
  // Unknown names reach AIClient, which rejects them with a CAPABILITY error.
  if (name !== "openai" && name !== "anthropic") return new AIClient(name);
  const credentials = aiCredentials(settings, name);
  return new AIClient(name, {
    apiKey: credentials.apiKey,
    model: purpose === "title" ? credentials.titleModel : credentials.chatModel,
  });
}

export function emailConfig(settings: RuntimeSettings, provider?: EmailProvider): EmailConfig {
  return {
    provider: provider ?? (String(settings["email.provider"].value) as EmailProvider),
    cloudflare: {
      accountId: text(settings, "email.cloudflare.accountId"),
      apiToken: text(settings, "email.cloudflare.apiToken"),
    },
    resend: { apiKey: text(settings, "email.resend.apiKey") },
    smtp: {
      host: text(settings, "email.smtp.host"),
      port: Number(settings["email.smtp.port"].value),
      secure: settings["email.smtp.secure"].value === true,
      user: text(settings, "email.smtp.user"),
      password: String(settings["email.smtp.password"].value ?? ""),
    },
  };
}

export function accountsFromAddress(settings: RuntimeSettings): string {
  return text(settings, "email.accountsFrom");
}

/** `null` when any of cloud name, key or secret is missing. */
export async function cloudinaryCredentials(): Promise<{
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} | null> {
  const settings = await loadRuntimeSettings();
  const cloudName = config.cloudinary.cloudName?.trim() ?? "";
  const apiKey = text(settings, "uploads.cloudinary.apiKey");
  const apiSecret = text(settings, "uploads.cloudinary.apiSecret");
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

export async function ahrefsApiKey(): Promise<string> {
  return text(await loadRuntimeSettings(), "integrations.ahrefs.apiKey");
}
