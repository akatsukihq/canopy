import "server-only";
import { z } from "zod";
import { AIError, normalizeAIError } from "./errors.ts";
import type { AIProviderName } from "./models.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { CompatibleProvider } from "./providers/compatible.ts";
import { OpenAIProvider } from "./providers/openai.ts";
import type { AIFileInput, AIImageInput, AIProvider, AIRequest, AIStreamEvent } from "./types.ts";

const providers: Record<AIProviderName, (options: AIClientOptions) => AIProvider> = {
  openai: (options) => new OpenAIProvider(options.model, options.apiKey),
  anthropic: (options) => new AnthropicProvider(options.model, options.apiKey),
  compatible: (options) => new CompatibleProvider(options.model, options.apiKey, options.baseUrl),
};
/** Omitted values fall back to the provider's environment configuration. */
export type AIClientOptions = { model?: string; apiKey?: string; /** `compatible` only. */ baseUrl?: string };
const content = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), fileId: z.string().min(1), mimeType: z.string().startsWith("image/") }),
  z.object({ type: z.literal("tool-call"), id: z.string().min(1), name: z.string().min(1), input: z.unknown() }),
  z.object({ type: z.literal("tool-result"), id: z.string().min(1), name: z.string().min(1), output: z.unknown() }),
]);
const messages = z
  .array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(content).min(1)]),
    }),
  )
  .min(1);

export class AIClient {
  readonly provider: string;
  private readonly adapter: AIProvider;

  constructor(provider: string, options: AIClientOptions = {}) {
    if (!Object.hasOwn(providers, provider)) throw new AIError("CAPABILITY", "This AI provider is not supported.", 400);
    this.provider = provider;
    this.adapter = providers[provider as AIProviderName](options);
  }

  get model() {
    return this.adapter.model;
  }
  getCapabilities() {
    return this.adapter.getCapabilities();
  }

  private validate(request: AIRequest) {
    if (request.signal?.aborted) throw new AIError("CANCELLED", "The AI request was cancelled.", 409);
    if (!messages.safeParse(request.messages).success)
      throw new AIError("VALIDATION", "Provide valid messages for the AI request.", 400);
    if (request.model !== undefined && !request.model.trim())
      throw new AIError("VALIDATION", "Provide a valid AI model.", 400);
    const capabilities = this.getCapabilities();
    if (!capabilities.configured) throw new AIError("CONFIGURATION", "The AI provider is not configured.", 503);
    if (
      (request.webSearch && !capabilities.webSearch) ||
      (request.schema && !capabilities.structuredOutput) ||
      (request.tools && !capabilities.tools)
    ) {
      throw new AIError("CAPABILITY", "The selected AI model does not support this operation.", 400);
    }
    if (
      !capabilities.images &&
      request.messages.some(
        (message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image"),
      )
    ) {
      throw new AIError("CAPABILITY", "The selected AI model does not support images.", 400);
    }
  }

  async generate(request: AIRequest) {
    this.validate(request);
    try {
      return await this.adapter.generate(request);
    } catch (error) {
      throw normalizeAIError(error);
    }
  }

  async *stream(request: AIRequest): AsyncIterable<AIStreamEvent> {
    this.validate(request);
    try {
      for await (const event of this.adapter.stream(request)) {
        yield event;
      }
    } catch (error) {
      throw normalizeAIError(error);
    }
  }

  private async operation<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      throw normalizeAIError(error);
    }
  }

  deleteResponse(id: string) {
    return this.operation(() => this.adapter.deleteResponse(id));
  }
  uploadFile(input: AIFileInput) {
    return this.operation(() => this.adapter.uploadFile(input));
  }
  deleteFile(id: string) {
    return this.operation(() => this.adapter.deleteFile(id));
  }
  generateImage(input: AIImageInput) {
    const generate = this.adapter.generateImage?.bind(this.adapter);
    if (!generate || !this.getCapabilities().imageGeneration)
      throw new AIError("CAPABILITY", "The selected AI provider cannot generate images.", 400);
    if (!input.prompt.trim()) throw new AIError("VALIDATION", "Provide an image prompt.", 400);
    return this.operation(() => generate(input));
  }
}
