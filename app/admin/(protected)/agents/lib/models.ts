import "server-only";
import { listModels } from "@/lib/ai/models.ts";
import { activeAIProvider, aiCredentials } from "@/lib/config/integrations.ts";
import { loadRuntimeSettings } from "@/lib/config/runtimeSettings.ts";
import { logError } from "@/lib/observability/logger.ts";

/** Models the active AI provider offers, plus its default. An empty list means the picker falls back to free text. */
export async function loadAgentModels(): Promise<{ models: string[]; defaultModel: string }> {
  const settings = await loadRuntimeSettings();
  const provider = activeAIProvider(settings);
  const credentials = aiCredentials(settings, provider);
  const baseUrl = "baseUrl" in credentials ? credentials.baseUrl : undefined;
  try {
    return {
      models: await listModels(provider, credentials.apiKey, undefined, baseUrl),
      defaultModel: credentials.chatModel,
    };
  } catch (error) {
    logError("agents.models.unavailable", error, { provider });
    return { models: [], defaultModel: credentials.chatModel };
  }
}
