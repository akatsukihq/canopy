import type { z } from "zod";

export type AIStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type AIContent =
  | { type: "text"; text: string }
  | { type: "image"; fileId: string; mimeType: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; name: string; output: unknown };
export type AIMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | AIContent[] };
export type AITool = {
  description: string;
  inputSchema: z.ZodType;
  execute?: (input: unknown, context: { toolCallId: string; signal?: AbortSignal }) => Promise<unknown>;
};
export type AIRequest = {
  messages: AIMessage[];
  schema?: z.ZodType;
  tools?: Record<string, AITool>;
  webSearch?: boolean;
  model?: string;
  /** Reasoning depth; providers or models without reasoning support ignore it. */
  effort?: AIEffort;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
};
export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AIEffort = (typeof AI_EFFORTS)[number];
export type AIHandle = { id: string; provider: string; model: string; status: AIStatus };
export type AIToolCall = { id: string; name: string; input: unknown; output?: unknown };
export type AICitation = { url: string; title: string; startIndex?: number; endIndex?: number };
export type AIResult = AIHandle & {
  text: string;
  output: unknown;
  toolCalls: AIToolCall[];
  citations: AICitation[];
  searchStatus?: "not_requested" | "completed" | "failed";
  metadata: Record<string, string>;
  details?: Record<string, unknown>;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  error?: { code: string; message: string };
};
export type AIStreamEvent =
  | { type: "response"; response: AIHandle }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "output"; output: unknown }
  | { type: "tool-call"; call: AIToolCall }
  | { type: "tool-result"; call: AIToolCall }
  | { type: "citation"; citation: AICitation }
  | { type: "completed"; result: AIResult };
export type AICapabilities = {
  provider: string;
  model: string;
  configured: boolean;
  images: boolean;
  structuredOutput: boolean;
  webSearch: boolean;
  urlRetrieval: boolean;
  tools: boolean;
  /** Can create images from a text prompt (generateImage). */
  imageGeneration: boolean;
};
export type AIFileInput = { data: Uint8Array; filename: string; mimeType: string };
export type AIImageInput = { prompt: string; size: `${number}x${number}`; signal?: AbortSignal };
export type AIImage = { data: Uint8Array; mimeType: string };
export type AIFile = { id: string; provider: string; filename: string; sizeBytes: number };

/** Internal provider contract. Feature callers use AIClient instead. */
export interface AIProvider {
  readonly model: string;
  getCapabilities(): AICapabilities;
  generate(request: AIRequest): Promise<AIResult>;
  stream(request: AIRequest): AsyncIterable<AIStreamEvent>;
  deleteResponse(id: string): Promise<void>;
  uploadFile(input: AIFileInput): Promise<AIFile>;
  deleteFile(id: string): Promise<void>;
  generateImage?(input: AIImageInput): Promise<AIImage>;
}
