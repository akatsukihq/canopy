import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { AIError } from "../errors.ts";
import type { AICapabilities, AIProvider, AIRequest, AIResult, AIStreamEvent } from "../types.ts";
import { resultFromSteps, sdkOptions, streamEvents } from "./sdk.ts";

const chunk = z.object({ id: z.string(), model: z.string() });

/**
 * Any endpoint speaking the OpenAI Chat Completions API (OpenRouter, Together,
 * Groq, vLLM, Ollama, LM Studio…). Only text, tools and structured output:
 * no hosted search, file uploads or stored responses.
 */
export class CompatibleProvider implements AIProvider {
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(model = process.env.OPENAI_COMPATIBLE_MODEL ?? "", apiKey?: string, baseUrl?: string) {
    this.model = model;
    this.apiKey = (apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY)?.trim() || undefined;
    this.baseUrl = (baseUrl ?? process.env.OPENAI_COMPATIBLE_BASE_URL)?.trim().replace(/\/+$/, "") || undefined;
  }

  getCapabilities(): AICapabilities {
    return {
      provider: "compatible",
      model: this.model,
      configured: Boolean(this.baseUrl && this.model),
      images: false,
      structuredOutput: true,
      webSearch: false,
      urlRetrieval: false,
      tools: true,
    };
  }

  private sdkOptions(request: AIRequest) {
    if (!this.baseUrl) throw new AIError("CONFIGURATION", "The AI provider is not configured.", 503);
    // The SDK requires a key; local servers ignore the placeholder.
    const provider = createOpenAI({ apiKey: this.apiKey ?? "not-needed", baseURL: this.baseUrl, name: "compatible" });
    return sdkOptions(request, {
      name: "compatible",
      model: provider.chat(request.model ?? this.model),
      webSearch: () => {
        throw new AIError("CAPABILITY", "This AI provider does not support web search.", 400);
      },
      providerOptions: {},
    });
  }

  async generate(request: AIRequest): Promise<AIResult> {
    const generated = await generateText(this.sdkOptions(request));
    return resultFromSteps("compatible", generated.steps, generated.usage, request, []);
  }

  stream(request: AIRequest): AsyncIterable<AIStreamEvent> {
    return streamEvents(request, (next) => this.sdkOptions(next), {
      handle(part) {
        if (part.type !== "raw") return null;
        const first = chunk.safeParse(part.rawValue);
        return first.success
          ? { id: first.data.id, provider: "compatible", model: first.data.model, status: "running" }
          : null;
      },
      result: (steps, usage) => resultFromSteps("compatible", steps, usage, request, []),
    });
  }

  /** Chat Completions stores nothing, so there is nothing to delete. */
  async deleteResponse() {}

  async uploadFile(): Promise<never> {
    throw new AIError("CAPABILITY", "The selected AI model does not support images.", 400);
  }

  async deleteFile() {}
}
