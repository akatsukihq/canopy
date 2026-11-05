/**
 * Server-only: provider credentials from runtime settings (Admin override,
 * else environment). Values here include decrypted secrets, so never pass
 * them to client components or logs.
 */
import "server-only";
import { createHash } from "node:crypto";
import { AIClient } from "../ai/client.ts";
import { listModelEntries, pickerModels, type ListedModel } from "../ai/models.ts";
import type { AIEffort } from "../ai/types.ts";
import type { EmailConfig, EmailProvider } from "../email/sender.ts";
import config from "./config.ts";
import { loadRuntimeSettings, type RuntimeSettings } from "./runtimeSettings.ts";

const text = (settings: RuntimeSettings, key: keyof RuntimeSettings) => String(settings[key].value ?? "").trim();

export type AIProviderName = "openai" | "anthropic" | "compatible";

export function aiCredentials(settings: RuntimeSettings, provider: AIProviderName) {
  if (provider === "compatible")
    return {
      apiKey: text(settings, "ai.compatible.apiKey"),
      chatModel: text(settings, "ai.compatibleModel"),
      titleModel: text(settings, "ai.compatibleTitleModel"),
      baseUrl: text(settings, "ai.compatible.baseUrl"),
    };
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
  const value = settings["ai.provider"].value;
  return value === "anthropic" || value === "compatible" ? value : "openai";
}

/**
 * An AI client with the runtime key and model. `provider` defaults to the active
 * one; pass a stored name to reach a past run's or file's provider.
 */
export async function createAIClient(provider?: string, purpose: "chat" | "title" = "chat"): Promise<AIClient> {
  const settings = await loadRuntimeSettings();
  const name = provider ?? activeAIProvider(settings);
  // Unknown names reach AIClient, which rejects them with a CAPABILITY error.
  if (name !== "openai" && name !== "anthropic" && name !== "compatible") return new AIClient(name);
  const credentials = aiCredentials(settings, name);
  return new AIClient(name, {
    apiKey: credentials.apiKey,
    model: purpose === "title" ? credentials.titleModel : credentials.chatModel,
    baseUrl: "baseUrl" in credentials ? credentials.baseUrl : undefined,
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
  const cloudName = text(settings, "uploads.cloudinary.cloudName");
  const apiKey = text(settings, "uploads.cloudinary.apiKey");
  const apiSecret = text(settings, "uploads.cloudinary.apiSecret");
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

export async function ahrefsApiKey(): Promise<string> {
  return text(await loadRuntimeSettings(), "integrations.ahrefs.apiKey");
}

export type AssistantModel = { id: string; name: string; efforts: AIEffort[] };
const MODEL_CACHE_MS = 10 * 60_000;
const modelCache = new Map<string, { at: number; models: ListedModel[] }>();

/**
 * The assistant picker's short list for the active provider (see pickerModels).
 * The configured chat model is always included and is the fallback when listing fails.
 * ponytail: per-process cache; share it if instances multiply.
 */
export async function assistantModels(): Promise<{
  provider: AIProviderName;
  defaultModel: string;
  models: AssistantModel[];
}> {
  const settings = await loadRuntimeSettings();
  const provider = activeAIProvider(settings);
  const credentials = aiCredentials(settings, provider);
  const baseUrl = "baseUrl" in credentials ? credentials.baseUrl : undefined;
  const defaultModel = (await createAIClient(provider)).getCapabilities().model;
  const key = createHash("sha256").update(JSON.stringify([provider, credentials.apiKey, baseUrl])).digest("hex");
  let listed = modelCache.get(key);
  if (!listed || Date.now() - listed.at > MODEL_CACHE_MS) {
    try {
      listed = { at: Date.now(), models: await listModelEntries(provider, credentials.apiKey, undefined, baseUrl) };
      modelCache.set(key, listed);
    } catch {
      listed = { at: 0, models: [] };
    }
  }
  return { provider, defaultModel, models: pickerModels(provider, listed.models, defaultModel) };
}
