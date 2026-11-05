import "server-only";
import { z } from "zod";
import { AIError } from "./errors.ts";
import { AI_EFFORTS, type AIEffort } from "./types.ts";

export const AI_PROVIDERS = ["openai", "anthropic", "compatible"] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

const TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const OPENAI_CHAT = /^(gpt-|o1|o3|o4|chatgpt-)/;
const OPENAI_EXCLUDED = /audio|realtime|transcribe|tts|image|embedding|moderation|search/;
const page = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
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

export type ListedModel = { id: string; name?: string };

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
  return (await listModelEntries(provider, apiKey, signal, baseUrl)).map((model) => model.id);
}

/** Like listModels, with the provider's display name when it gives one (Anthropic does). */
export async function listModelEntries(
  provider: AIProviderName,
  apiKey: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ListedModel[]> {
  if (!AI_PROVIDERS.includes(provider)) throw new AIError("CAPABILITY", "This AI provider is not supported.", 400);
  if (provider !== "compatible" && !apiKey.trim()) throw new AIError("VALIDATION", "Provide an API key.", 400);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const ids: ListedModel[] = [];
  const entry = (model: { id: string; display_name?: string }): ListedModel =>
    model.display_name ? { id: model.id, name: model.display_name } : { id: model.id };
  if (provider === "compatible") {
    if (!baseUrl?.trim()) throw new AIError("VALIDATION", "Provide the endpoint base URL.", 400);
    // Endpoints differ in what they list; offer everything they return.
    const body = await fetchPage(
      `${baseUrl.trim().replace(/\/+$/, "")}/models`,
      apiKey.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {},
      combined,
    );
    ids.push(...body.data.map(entry));
  } else if (provider === "openai") {
    const body = await fetchPage(
      "https://api.openai.com/v1/models",
      { authorization: `Bearer ${apiKey}` },
      combined,
    );
    ids.push(...body.data.filter(({ id }) => OPENAI_CHAT.test(id) && !OPENAI_EXCLUDED.test(id)).map(entry));
  } else {
    let after: string | null | undefined;
    for (let count = 0; count < MAX_PAGES; count += 1) {
      const query = new URLSearchParams({ limit: "1000", ...(after ? { after_id: after } : {}) });
      const body = await fetchPage(
        `https://api.anthropic.com/v1/models?${query}`,
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        combined,
      );
      ids.push(...body.data.map(entry));
      after = body.last_id;
      if (!body.has_more || !after) break;
    }
  }
  const unique = new Map(ids.map((model) => [model.id, model]));
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Reasoning efforts a chat model accepts, lowest first; empty when it takes none.
 * Compatible endpoints are not assumed to, since many reject the field.
 * ponytail: id patterns; move to provider model metadata if the APIs expose it.
 */
export function effortLevels(provider: string, model: string): AIEffort[] {
  if (provider === "anthropic") {
    if (!/^claude-/.test(model) || /^claude-3-(?:haiku|opus|sonnet|5)/.test(model)) return [];
    return /haiku/.test(model) ? ["low", "medium", "high"] : [...AI_EFFORTS];
  }
  if (provider === "openai" && /^(?:o\d|gpt-(?:[5-9]|\d{2}))/.test(model) && !/chat-latest/.test(model))
    return ["low", "medium", "high"];
  return [];
}

const VERSIONS_PER_FAMILY = 3;
const SNAPSHOT = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$|latest|preview/;
/** Family and numeric version of a current-generation id; null for legacy or unknown ids. */
function family(provider: string, id: string): { name: string; version: number } | null {
  if (provider === "anthropic") {
    const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?$/.exec(id);
    return match ? { name: match[1], version: Number(match[2]) + Number(match[3] ?? 0) / 10 } : null;
  }
  if (provider === "openai") {
    const match = /^gpt-(\d+(?:\.\d+)?)/.exec(id);
    return match && Number(match[1]) >= 5 ? { name: "gpt", version: Number(match[1]) } : null;
  }
  return null;
}

/** `gpt-5.6-terra` → `GPT-5.6 Terra`; Anthropic ids are named by the API. */
function readableName(id: string) {
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/.exec(id);
  if (!gpt) return id;
  const variant = gpt[2]?.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  return `GPT-${gpt[1]}${variant ? ` ${variant}` : ""}`;
}

/**
 * The short list the assistant offers: current generations only, no dated snapshots or
 * previews, and the newest few versions of each family. The admin default always stays.
 * Compatible endpoints are unknown, so their list is kept as returned.
 */
export function pickerModels(provider: string, listed: ListedModel[], defaultModel: string) {
  const versions = new Map<string, number[]>();
  for (const model of listed) {
    const kind = SNAPSHOT.test(model.id) ? null : family(provider, model.id);
    if (kind) versions.set(kind.name, [...new Set([...(versions.get(kind.name) ?? []), kind.version])]);
  }
  const kept = listed.filter((model) => {
    if (model.id === defaultModel || provider === "compatible") return true;
    const kind = SNAPSHOT.test(model.id) ? null : family(provider, model.id);
    if (!kind) return false;
    const newest = (versions.get(kind.name) ?? []).sort((a, b) => b - a).slice(0, VERSIONS_PER_FAMILY);
    return newest.includes(kind.version);
  });
  if (!kept.some((model) => model.id === defaultModel) && defaultModel) kept.unshift({ id: defaultModel });
  // Newest first within each family, families in a stable order.
  const rank = (model: ListedModel) => family(provider, model.id);
  return kept
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      if (!x || !y) return a.id.localeCompare(b.id);
      return x.name === y.name ? y.version - x.version || a.id.localeCompare(b.id) : x.name.localeCompare(y.name);
    })
    .map((model) => ({ id: model.id, name: model.name ?? readableName(model.id), efforts: effortLevels(provider, model.id) }));
}
