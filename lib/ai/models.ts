import "server-only";
import { z } from "zod";
import { AIError } from "./errors.ts";

export const AI_PROVIDERS = ["openai", "anthropic", "compatible"] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

const TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const OPENAI_CHAT = /^(gpt-|o1|o3|o4|chatgpt-)/;
const OPENAI_EXCLUDED = /audio|realtime|transcribe|tts|image|embedding|moderation|search/;
const page = z.object({
  data: z.array(z.object({ id: z.string() })),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});

async function fetchPage(url: string, headers: Record<string, string>, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch (error) {
    if (signal.aborted && !(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"))
      throw new AIError("CANCELLED", "The model list request was cancelled.", 409);
    throw new AIError("PROVIDER", "The AI provider could not be reached. Try again.", 502, true, { cause: error });
  }
  if (response.status === 401 || response.status === 403)
    throw new AIError("CONFIGURATION", "The API key was rejected.", 400);
  if (response.status === 429) throw new AIError("RATE_LIMIT", "The AI provider is busy. Try again shortly.", 429, true);
  if (!response.ok) throw new AIError("PROVIDER", "The AI provider could not list models. Try again.", 502, true);
  const parsed = page.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AIError("INVALID_OUTPUT", "The AI provider returned an invalid model list.");
  return parsed.data;
}

/**
 * Lists the chat-capable model ids the key can use, sorted and deduplicated.
 * `baseUrl` is required for `compatible`, whose key is optional.
 */
export async function listModels(
  provider: AIProviderName,
  apiKey: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<string[]> {
  if (!AI_PROVIDERS.includes(provider)) throw new AIError("CAPABILITY", "This AI provider is not supported.", 400);
  if (provider !== "compatible" && !apiKey.trim()) throw new AIError("VALIDATION", "Provide an API key.", 400);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const ids: string[] = [];
  if (provider === "compatible") {
    if (!baseUrl?.trim()) throw new AIError("VALIDATION", "Provide the endpoint base URL.", 400);
    // Endpoints differ in what they list; offer everything they return.
    const body = await fetchPage(
      `${baseUrl.trim().replace(/\/+$/, "")}/models`,
      apiKey.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {},
      combined,
    );
    ids.push(...body.data.map((model) => model.id));
  } else if (provider === "openai") {
    const body = await fetchPage(
      "https://api.openai.com/v1/models",
      { authorization: `Bearer ${apiKey}` },
      combined,
    );
    ids.push(...body.data.map((model) => model.id).filter((id) => OPENAI_CHAT.test(id) && !OPENAI_EXCLUDED.test(id)));
  } else {
    let after: string | null | undefined;
    for (let count = 0; count < MAX_PAGES; count += 1) {
      const query = new URLSearchParams({ limit: "1000", ...(after ? { after_id: after } : {}) });
      const body = await fetchPage(
        `https://api.anthropic.com/v1/models?${query}`,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        combined,
      );
      ids.push(...body.data.map((model) => model.id));
      after = body.last_id;
      if (!body.has_more || !after) break;
    }
  }
  return [...new Set(ids)].sort();
}
