import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage, generateText } from "ai";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import config from "@/lib/config/config.ts";
import { AIError } from "../errors.ts";
import type {
  AICapabilities,
  AIFileInput,
  AIImageInput,
  AIProvider,
  AIRequest,
  AIResult,
  AIStreamEvent,
} from "../types.ts";
import { fileId, resultFromSteps, sdkOptions, streamEvents, type SearchEvidence } from "./sdk.ts";

const IMAGE_MODEL = "gpt-image-2";

function responseId(id: string) {
  if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new AIError("VALIDATION", "Invalid AI response reference.", 400);
  return id;
}

// SDK tool results omit hosted-search execution status. Only the provider's terminal evidence proves success.
function searchEvidence(responses: unknown[]): SearchEvidence[] {
  return responses.flatMap((response) => {
    const parsed = z
      .object({
        output: z.array(
          z.object({
            type: z.string(),
            status: z.string().optional(),
            action: z
              .object({ sources: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional() })
              .optional(),
          }),
        ),
      })
      .safeParse(response);
    return parsed.success
      ? parsed.data.output
          .filter((item) => item.type === "web_search_call")
          .map((item) => ({ completed: item.status === "completed", sources: item.action?.sources ?? [] }))
      : [];
  });
}

export class OpenAIProvider implements AIProvider {
  readonly model: string;
  private readonly apiKey: string | undefined;

  /** `model` and `apiKey` are the effective runtime settings; env applies when the caller has none. */
  constructor(model = config.ai.openai.model, apiKey = config.ai.openai.apiKey) {
    this.model = model;
    this.apiKey = apiKey || undefined;
  }

  private key() {
    if (!this.apiKey) throw new AIError("CONFIGURATION", "The AI provider is not configured.", 503);
    return this.apiKey;
  }

  private sdk() {
    return new OpenAI({ apiKey: this.key(), maxRetries: 0, timeout: 20_000 });
  }

  getCapabilities(): AICapabilities {
    return {
      provider: "openai",
      model: this.model,
      configured: Boolean(this.apiKey),
      images: true,
      structuredOutput: true,
      webSearch: true,
      urlRetrieval: true,
      tools: true,
      imageGeneration: true,
    };
  }

  private sdkOptions(request: AIRequest) {
    const provider = createOpenAI({ apiKey: this.key() });
    return sdkOptions(request, {
      name: "openai",
      model: provider.responses(request.model ?? this.model),
      webSearch: () => provider.tools.webSearch({}),
      providerOptions: { openai: { store: false, metadata: request.metadata } },
    });
  }

  async generate(request: AIRequest): Promise<AIResult> {
    const generated = await generateText({ ...this.sdkOptions(request), include: { responseBody: true } });
    return resultFromSteps(
      "openai",
      generated.steps,
      generated.usage,
      request,
      searchEvidence(generated.steps.map((step) => step.response.body)),
    );
  }

  stream(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const responses: unknown[] = [];
    return streamEvents(request, (next) => this.sdkOptions(next), {
      handle(part) {
        if (part.type !== "raw") return null;
        const terminal = z
          .object({
            type: z.enum(["response.completed", "response.failed", "response.incomplete"]),
            response: z.unknown(),
          })
          .safeParse(part.rawValue);
        if (terminal.success) responses.push(terminal.data.response);
        // The normalized SDK stream exposes response identity only after a step ends.
        const event = z
          .object({ type: z.literal("response.created"), response: z.object({ id: z.string(), model: z.string() }) })
          .safeParse(part.rawValue);
        return event.success
          ? { id: event.data.response.id, provider: "openai", model: event.data.response.model, status: "running" }
          : null;
      },
      result: (steps, usage) => resultFromSteps("openai", steps, usage, request, searchEvidence(responses)),
    });
  }

  async deleteResponse(id: string) {
    try {
      await this.sdk().responses.delete(responseId(id));
    } catch (error) {
      if (!(error instanceof OpenAI.APIError && error.status === 404)) throw error;
    }
  }

  async uploadFile(input: AIFileInput) {
    if (!input.filename.trim() || !input.mimeType.trim() || !input.data.byteLength)
      throw new AIError("VALIDATION", "Provide a nonempty file with its name and type.", 400);
    const file = await this.sdk().files.create({
      file: await toFile(input.data, input.filename, { type: input.mimeType }),
      purpose: "user_data",
      expires_after: { anchor: "created_at", seconds: 30 * 24 * 60 * 60 },
    });
    if (typeof file.id !== "string" || typeof file.bytes !== "number")
      throw new AIError("INVALID_OUTPUT", "The AI provider did not return a valid file reference.");
    return { id: fileId(file.id), provider: "openai", filename: file.filename, sizeBytes: file.bytes };
  }
  async generateImage(input: AIImageInput) {
    const { image } = await generateImage({
      model: createOpenAI({ apiKey: this.key() }).image(IMAGE_MODEL),
      prompt: input.prompt,
      size: input.size,
      abortSignal: input.signal,
      maxRetries: 1,
      // WebP keeps generated images well under the 5 MiB blog image limit.
      providerOptions: { openai: { quality: "medium", outputFormat: "webp", outputCompression: 85 } },
    });
    return { data: image.uint8Array, mimeType: image.mediaType || "image/webp" };
  }
  async deleteFile(id: string) {
    try {
      await this.sdk().files.delete(fileId(id));
    } catch (error) {
      if (!(error instanceof OpenAI.APIError && error.status === 404)) throw error;
    }
  }
}
