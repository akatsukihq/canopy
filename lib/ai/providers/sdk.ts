import "server-only";
import {
  generateText,
  streamText,
  stepCountIs,
  Output,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type StepResult,
  type LanguageModelUsage,
  type TextStreamPart,
} from "ai";
import { AIError, normalizeAIError } from "../errors.ts";
import type { AICitation, AIHandle, AIMessage, AIRequest, AIResult, AIStreamEvent } from "../types.ts";

/** Shared Vercel AI SDK adapter code for providers that run through `generateText`/`streamText`. */

export type SearchEvidence = { completed: boolean; sources: { url: string; title?: string }[] };

export function citation(value: { url: string; title?: string }): AICitation | null {
  try {
    const url = new URL(value.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return { url: url.href, title: value.title || url.hostname };
  } catch {
    return null;
  }
}

export function fileId(id: string) {
  if (!/^file[-_][A-Za-z0-9_-]+$/.test(id)) throw new AIError("VALIDATION", "Invalid AI file reference.", 400);
  return id;
}

export function resultFromSteps(
  provider: string,
  steps: StepResult<ToolSet>[],
  usage: LanguageModelUsage,
  request: AIRequest,
  searches: SearchEvidence[],
): AIResult {
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
    for (const source of search.sources) {
      const value = citation(source);
      if (value) citations.push(value);
    }
  const result: AIResult = {
    id: final.response.id,
    provider,
    model: final.response.modelId,
    status: "completed",
    text: steps.map((step) => step.text).join(""),
    output: null,
    toolCalls: calls,
    citations: citations.filter((source, index) => citations.findIndex((other) => other.url === source.url) === index),
    searchStatus: searches.length
      ? searches.every((search) => search.completed)
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
  // A failed hosted search is reported through searchStatus, not as a failed caller tool.
  if (steps.some((step) => step.content.some((part) => part.type === "tool-error" && part.toolName !== "web_search"))) {
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

/** `fileProvider` names the provider whose uploaded file ids image parts reference. */
function sdkMessages(messages: AIMessage[], fileProvider: string): ModelMessage[] {
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
              data: { type: "reference" as const, reference: { [fileProvider]: fileId(part.fileId) } },
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

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export function sdkOptions(
  request: AIRequest,
  provider: {
    name: string;
    model: LanguageModel;
    webSearch: () => ToolSet[string];
    providerOptions: ProviderOptions;
  },
) {
  const tools: ToolSet = {};
  for (const [name, definition] of Object.entries(request.tools ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name) || name === "web_search")
      throw new AIError("VALIDATION", "Invalid or reserved AI tool name.", 400);
    const execute = definition.execute;
    tools[name] = execute
      ? tool<unknown, unknown, Record<string, unknown>>({
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: (input, options) => execute(input, { toolCallId: options.toolCallId, signal: options.abortSignal }),
        })
      : tool<unknown, Record<string, unknown>>({
          description: definition.description,
          inputSchema: definition.inputSchema,
        });
  }
  if (request.webSearch) tools.web_search = provider.webSearch();
  const messages = sdkMessages(request.messages, provider.name);
  return {
    model: provider.model,
    instructions: messages.filter((message) => message.role === "system"),
    messages: messages.filter((message) => message.role !== "system"),
    tools,
    ...(request.schema ? { output: Output.object({ schema: request.schema }) } : {}),
    stopWhen: stepCountIs(5),
    maxRetries: 0,
    abortSignal: request.signal,
    providerOptions: provider.providerOptions,
  };
}

export async function* streamEvents(
  request: AIRequest,
  build: (request: AIRequest) => ReturnType<typeof sdkOptions>,
  hooks: {
    /** Returns the provider handle when a stream part first reveals it. */
    handle(part: TextStreamPart<ToolSet>): AIHandle | null;
    result(steps: StepResult<ToolSet>[], usage: LanguageModelUsage): AIResult;
  },
): AsyncIterable<AIStreamEvent> {
  const reportedUsage = new Map<string, LanguageModelUsage>();
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  const generated = streamText({
    ...build({ ...request, signal }),
    include: { rawChunks: true },
    onError: () => {},
    onStepEnd: (step) => {
      reportedUsage.set(step.response.id, step.usage);
    },
  });
  let handleSent = false;
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
      const handle = handleSent ? null : hooks.handle(part);
      if (handle) {
        yield { type: "response", response: handle };
        handleSent = true;
      }
      if (part.type === "text-delta") yield { type: "text-delta", text: part.text };
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
    const result = hooks.result(await generated.steps, await generated.usage);
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
