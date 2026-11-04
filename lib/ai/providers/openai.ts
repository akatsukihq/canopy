import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  stepCountIs,
  Output,
  tool,
  type ModelMessage,
  type ToolSet,
  type StepResult,
  type LanguageModelUsage,
} from "ai";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import config from "@/lib/config/config.ts";
import { AIError, normalizeAIError } from "../errors.ts";
import type {
  AICapabilities,
  AICitation,
  AIFileInput,
  AIMessage,
  AIProvider,
  AIRequest,
  AIResult,
  AIStreamEvent,
} from "../types.ts";

function citation(value: { url: string; title?: string }): AICitation | null {
  try {
    const url = new URL(value.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return { url: url.href, title: value.title || url.hostname };
  } catch {
    return null;
  }
}

function resourceId(id: string, kind: "response" | "file") {
  const pattern = kind === "response" ? /^resp_[A-Za-z0-9_-]+$/ : /^file[-_][A-Za-z0-9_-]+$/;
  if (!pattern.test(id)) throw new AIError("VALIDATION", `Invalid AI ${kind} reference.`, 400);
  return id;
}

function resultFromSteps(
  steps: StepResult<ToolSet>[],
  usage: LanguageModelUsage,
  request: AIRequest,
  responses: unknown[],
): AIResult {
  // SDK tool results omit hosted-search execution status. Only the provider's terminal evidence proves success.
  const searches = responses.flatMap((response) => {
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
    return parsed.success ? parsed.data.output.filter((item) => item.type === "web_search_call") : [];
  });
  const final = steps.at(-1);
  if (!final) throw new AIError("INVALID_OUTPUT", "The AI provider returned no response.");
  const calls = steps.flatMap((step) =>
    step.toolCalls.map((call) => {
      const output = step.toolResults.find((result) => result.toolCallId === call.toolCallId);
      return {
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
        ...(output ? { output: output.output } : {}),
      };
    }),
  );
  const citations = steps.flatMap((step) =>
    step.sources.flatMap((source) => {
      const value = source.sourceType === "url" ? citation(source) : null;
      return value ? [value] : [];
    }),
  );
  for (const search of searches)
    for (const source of search.action?.sources ?? []) {
      const value = citation(source);
      if (value) citations.push(value);
    }
  const result: AIResult = {
    id: final.response.id,
    provider: "openai",
    model: final.response.modelId,
    status: "completed",
    text: steps.map((step) => step.text).join(""),
    output: null,
    toolCalls: calls,
    citations: citations.filter((source, index) => citations.findIndex((other) => other.url === source.url) === index),
    searchStatus: searches.length
      ? searches.every((search) => search.status === "completed")
        ? "completed"
        : "failed"
      : "not_requested",
    metadata: request.metadata ?? {},
    details: {
      finishReason: final.finishReason,
      responses: steps.map((step) => ({ id: step.response.id, model: step.response.modelId })),
    },
    usage: {
      ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
      ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    },
  };
  if (steps.some((step) => step.content.some((part) => part.type === "tool-error"))) {
    result.status = "failed";
    result.error = { code: "TOOL_FAILED", message: "An AI tool could not complete. Try again." };
  } else if (["length", "error", "content-filter"].includes(final.finishReason)) {
    result.status = "failed";
    result.error = { code: "INCOMPLETE", message: "The AI response did not complete. Your input is preserved." };
  } else if (!result.text.trim() && !calls.length) {
    result.status = "failed";
    result.error = { code: "EMPTY_OUTPUT", message: "The AI provider returned no content. Try again." };
  } else if (request.schema) {
    try {
      const parsed = request.schema.safeParse(JSON.parse(final.text));
      if (!parsed.success) throw new Error("Invalid structured output");
      result.output = parsed.data;
    } catch {
      result.status = "failed";
      result.error = { code: "INVALID_OUTPUT", message: "The generated result did not match the requested format." };
    }
  }
  return result;
}

function sdkMessages(messages: AIMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (typeof message.content === "string") {
      if (message.role === "tool")
        throw new AIError("VALIDATION", "Tool messages require a matching call result.", 400);
      return { role: message.role, content: message.content };
    }
    const parts = message.content;
    if (message.role === "system") {
      if (parts.some((part) => part.type !== "text"))
        throw new AIError("VALIDATION", "System context must contain text.", 400);
      return { role: "system", content: parts.map((part) => (part.type === "text" ? part.text : "")).join("\n") };
    }
    if (message.role === "user")
      return {
        role: "user",
        content: parts.map((part) => {
          if (part.type === "text") return part;
          if (part.type === "image")
            return {
              type: "file" as const,
              mediaType: part.mimeType,
              data: { type: "reference" as const, reference: { openai: resourceId(part.fileId, "file") } },
            };
          throw new AIError("VALIDATION", "User messages cannot contain tool commands.", 400);
        }),
      };
    if (message.role === "assistant")
      return {
        role: "assistant",
        content: parts.map((part) => {
          if (part.type === "text") return part;
          if (part.type === "tool-call")
            return { type: "tool-call" as const, toolCallId: part.id, toolName: part.name, input: part.input };
          throw new AIError("VALIDATION", "Invalid assistant message content.", 400);
        }),
      };
    return {
      role: "tool",
      content: parts.map((part) => {
        if (part.type !== "tool-result")
          throw new AIError("VALIDATION", "Tool messages require a matching call result.", 400);
        return {
          type: "tool-result" as const,
          toolCallId: part.id,
          toolName: part.name,
          output: { type: "text" as const, value: JSON.stringify(part.output) ?? "null" },
        };
      }),
    };
  });
}

export class OpenAIProvider implements AIProvider {
  readonly model: string;

  /** `model` is the effective runtime setting; env applies when the caller has none. */
  constructor(model = config.ai.openai.model) {
    this.model = model;
  }

  private credentials() {
    const credentials = config.ai.openai;
    if (!credentials.apiKey) throw new AIError("CONFIGURATION", "The AI provider is not configured.", 503);
    return credentials;
  }

  private sdk() {
    return new OpenAI({ apiKey: this.credentials().apiKey, maxRetries: 0, timeout: 20_000 });
  }

  getCapabilities(): AICapabilities {
    return {
      provider: "openai",
      model: this.model,
      configured: Boolean(config.ai.openai.apiKey),
      images: true,
      structuredOutput: true,
      webSearch: true,
      urlRetrieval: true,
      tools: true,
    };
  }

  private sdkOptions(request: AIRequest) {
    const provider = createOpenAI({ apiKey: this.credentials().apiKey });
    const tools: ToolSet = {};
    for (const [name, definition] of Object.entries(request.tools ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name) || name === "web_search")
        throw new AIError("VALIDATION", "Invalid or reserved AI tool name.", 400);
      const execute = definition.execute;
      tools[name] = execute
        ? tool<unknown, unknown, Record<string, unknown>>({
            description: definition.description,
            inputSchema: definition.inputSchema,
            execute: (input, options) =>
              execute(input, { toolCallId: options.toolCallId, signal: options.abortSignal }),
          })
        : tool<unknown, Record<string, unknown>>({
            description: definition.description,
            inputSchema: definition.inputSchema,
          });
    }
    if (request.webSearch) tools.web_search = provider.tools.webSearch({});
    const messages = sdkMessages(request.messages);
    return {
      model: provider.responses(request.model ?? this.model),
      instructions: messages.filter((message) => message.role === "system"),
      messages: messages.filter((message) => message.role !== "system"),
      tools,
      ...(request.schema ? { output: Output.object({ schema: request.schema }) } : {}),
      stopWhen: stepCountIs(5),
      maxRetries: 0,
      abortSignal: request.signal,
      providerOptions: { openai: { store: false, metadata: request.metadata } },
    };
  }

  async generate(request: AIRequest): Promise<AIResult> {
    const generated = await generateText({ ...this.sdkOptions(request), include: { responseBody: true } });
    return resultFromSteps(
      generated.steps,
      generated.usage,
      request,
      generated.steps.map((step) => step.response.body),
    );
  }

  async *stream(request: AIRequest): AsyncIterable<AIStreamEvent> {
    const reportedUsage = new Map<string, LanguageModelUsage>();
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const generated = streamText({
      ...this.sdkOptions({ ...request, signal }),
      include: { rawChunks: true },
      onError: () => {},
      onStepEnd: (step) => {
        reportedUsage.set(step.response.id, step.usage);
      },
    });
    let handleSent = false;
    const responses: unknown[] = [];
    const reader = generated.stream.getReader();
    const partialReader = request.schema ? generated.partialOutputStream.getReader() : null;
    const nextPart = () =>
      reader.read().then(
        (value) => ({ type: "part" as const, value }),
        (error) => ({ type: "error" as const, error }),
      );
    const nextOutput = () =>
      partialReader!.read().then(
        (value) => ({ type: "output" as const, value }),
        (error) => ({ type: "error" as const, error }),
      );
    let pendingPart: ReturnType<typeof nextPart> | null = nextPart();
    let pendingOutput: ReturnType<typeof nextOutput> | null = partialReader ? nextOutput() : null;
    try {
      while (pendingPart || pendingOutput) {
        const next: Awaited<ReturnType<typeof nextPart>> | Awaited<ReturnType<typeof nextOutput>> = await Promise.race([
          ...(pendingPart ? [pendingPart] : []),
          ...(pendingOutput ? [pendingOutput] : []),
        ]);
        if (next.type === "error") throw next.error;
        if (next.type === "output") {
          pendingOutput = next.value.done ? null : nextOutput();
          if (!next.value.done) yield { type: "output", output: next.value.value };
          continue;
        }
        pendingPart = next.value.done ? null : nextPart();
        if (next.value.done) continue;
        const part = next.value.value;
        if (part.type === "raw") {
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
          if (event.success) {
            yield {
              type: "response",
              response: {
                id: event.data.response.id,
                provider: "openai",
                model: event.data.response.model,
                status: "running",
              },
            };
            handleSent = true;
          }
        } else if (part.type === "text-delta") yield { type: "text-delta", text: part.text };
        else if (part.type === "tool-call")
          yield { type: "tool-call", call: { id: part.toolCallId, name: part.toolName, input: part.input } };
        else if (part.type === "tool-result")
          yield {
            type: "tool-result",
            call: { id: part.toolCallId, name: part.toolName, input: part.input, output: part.output },
          };
        else if (part.type === "source" && part.sourceType === "url") {
          const source = citation(part);
          if (source) yield { type: "citation", citation: source };
        } else if (part.type === "error") throw part.error;
        else if (part.type === "abort") throw new AIError("CANCELLED", "The AI request was cancelled.", 409);
      }
      const result = resultFromSteps(await generated.steps, await generated.usage, request, responses);
      if (!handleSent) yield { type: "response", response: result };
      yield { type: "completed", result };
    } catch (error) {
      const normalized = normalizeAIError(error);
      for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
        const values = [...reportedUsage.values()].flatMap((usage) => (usage[key] === undefined ? [] : [usage[key]]));
        if (values.length) (normalized.usage ??= {})[key] = values.reduce((sum, value) => sum + value, 0);
      }
      throw normalized;
    } finally {
      controller.abort();
      // SDK keeps an internal tee for result promises; awaiting branch cancellation can wait on that retained branch.
      void Promise.allSettled([reader.cancel(), ...(partialReader ? [partialReader.cancel()] : [])]);
      reader.releaseLock();
      partialReader?.releaseLock();
    }
  }

  async deleteResponse(id: string) {
    try {
      await this.sdk().responses.delete(resourceId(id, "response"));
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
    return { id: resourceId(file.id, "file"), provider: "openai", filename: file.filename, sizeBytes: file.bytes };
  }
  async deleteFile(id: string) {
    try {
      await this.sdk().files.delete(resourceId(id, "file"));
    } catch (error) {
      if (!(error instanceof OpenAI.APIError && error.status === 404)) throw error;
    }
  }
}
