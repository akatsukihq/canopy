import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, uploadFile, type StepResult, type ToolSet } from "ai";
import { z } from "zod";
import config from "@/lib/config/config.ts";
import { AIError } from "../errors.ts";
import type { AICapabilities, AIFileInput, AIProvider, AIRequest, AIResult, AIStreamEvent } from "../types.ts";
import { fileId, resultFromSteps, sdkOptions, streamEvents, type SearchEvidence } from "./sdk.ts";

const API_URL = "https://api.anthropic.com/v1";
const FILES_BETA = "files-api-2025-04-14";
const messageStart = z.object({
  type: z.literal("message_start"),
  message: z.object({ id: z.string(), model: z.string() }),
});

// Hosted search results arrive as provider-executed tool results; their sources are already step sources.
function searchEvidence(steps: StepResult<ToolSet>[]): SearchEvidence[] {
  return steps.flatMap((step) =>
    step.content.flatMap((part) =>
      (part.type === "tool-result" || part.type === "tool-error") && part.toolName === "web_search"
        ? [{ completed: part.type === "tool-result", sources: [] }]
        : [],
    ),
  );
}

export class AnthropicProvider implements AIProvider {
  readonly model: string;
  private readonly apiKey: string | undefined;

  /** `model` and `apiKey` are the effective runtime settings; env applies when the caller has none. */
  constructor(model = config.ai.anthropic.model, apiKey = config.ai.anthropic.apiKey) {
    this.model = model;
    this.apiKey = apiKey || undefined;
  }

  private key() {
    if (!this.apiKey) throw new AIError("CONFIGURATION", "The AI provider is not configured.", 503);
    return this.apiKey;
  }

  private provider() {
    return createAnthropic({ apiKey: this.key() });
  }

  getCapabilities(): AICapabilities {
    return {
      provider: "anthropic",
      model: this.model,
      configured: Boolean(this.apiKey),
      images: true,
      structuredOutput: true,
      webSearch: true,
      // ponytail: web fetch tool not wired; add anthropic.tools.webFetch_20260318 when a caller needs URL retrieval.
      urlRetrieval: false,
      tools: true,
      imageGeneration: false,
    };
  }

  private sdkOptions(request: AIRequest) {
    const provider = this.provider();
    return sdkOptions(request, {
      name: "anthropic",
      model: provider(request.model ?? this.model),
      webSearch: () => provider.tools.webSearch_20260318({ maxUses: 5 }),
      providerOptions:
        request.effort === "max"
          ? { anthropic: { effort: "max", thinking: { type: "adaptive", display: "summarized" } } }
          : {},
    });
  }

  async generate(request: AIRequest): Promise<AIResult> {
    const generated = await generateText(this.sdkOptions(request));
    return resultFromSteps("anthropic", generated.steps, generated.usage, request, searchEvidence(generated.steps));
  }

  stream(request: AIRequest): AsyncIterable<AIStreamEvent> {
    return streamEvents(request, (next) => this.sdkOptions(next), {
      handle(part) {
        if (part.type !== "raw") return null;
        const start = messageStart.safeParse(part.rawValue);
        return start.success
          ? { id: start.data.message.id, provider: "anthropic", model: start.data.message.model, status: "running" }
          : null;
      },
      result: (steps, usage) => resultFromSteps("anthropic", steps, usage, request, searchEvidence(steps)),
    });
  }

  /** Anthropic does not store responses, so there is nothing to delete. */
  async deleteResponse() {}

  async uploadFile(input: AIFileInput) {
    if (!input.filename.trim() || !input.mimeType.trim() || !input.data.byteLength)
      throw new AIError("VALIDATION", "Provide a nonempty file with its name and type.", 400);
    const file = await uploadFile({
      api: this.provider().files(),
      data: input.data,
      filename: input.filename,
      mediaType: input.mimeType,
    });
    const id = file.providerReference.anthropic;
    if (typeof id !== "string")
      throw new AIError("INVALID_OUTPUT", "The AI provider did not return a valid file reference.");
    return { id: fileId(id), provider: "anthropic", filename: input.filename, sizeBytes: input.data.byteLength };
  }

  async deleteFile(id: string) {
    const response = await fetch(`${API_URL}/files/${fileId(id)}`, {
      method: "DELETE",
      headers: { "x-api-key": this.key(), "anthropic-version": "2023-06-01", "anthropic-beta": FILES_BETA },
      signal: AbortSignal.timeout(20_000),
    });
    // normalizeAIError maps the status; the body is never surfaced.
    if (!response.ok && response.status !== 404) throw { status: response.status };
  }
}
