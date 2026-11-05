import type { AIEffort } from "../ai/types.ts";
import type { JSONContent } from "@tiptap/core";

/** Title of a thread the title model has not named yet. */
export const NEW_THREAD_TITLE = "New thread";

export type AssistantExecutionMode = "conversational" | "standalone";
export type AssistantRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type AssistantRunRequest = {
  schemaVersion?: number;
  clientRequestId: string;
  operation: string;
  agentId?: string;
  message: string;
  resourceId?: string;
  threadId?: string;
  inputMessageId?: string;
  context?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  references?: string[];
  attachmentIds?: string[];
  model?: string;
  effort?: AIEffort;
};
export type AssistantProposal = {
  id: string;
  title?: string;
  status: "pending" | "applied" | "discarded" | "stale" | "failed";
  data: Record<string, unknown>;
};
export type AssistantArtifact = {
  schemaVersion: number;
  agentVersion: number;
  agentId: string;
  summary: string;
  content: unknown;
  [key: string]: unknown;
};
export type AssistantArtifactReference = {
  attachmentId: string;
  label: string;
  agentId: string;
  summary: string;
  [key: string]: unknown;
};
export type AssistantResult = {
  text: string;
  citations: Array<{ url: string; title: string }>;
  proposals: AssistantProposal[];
  artifact?: AssistantArtifactReference;
  data?: Record<string, unknown>;
};
export type AssistantRun = {
  id: string;
  integrationKey: string;
  resourceId: string | null;
  threadId: string | null;
  executionMode: AssistantExecutionMode;
  operation: string;
  status: AssistantRunStatus;
  provider: string;
  model: string;
  inputMessageId: string | null;
  assistantMessageId: string | null;
  request: AssistantRunRequest;
  response: AssistantResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type AssistantComposerSelection = {
  agentId?: string;
  agentOffset?: number;
  content?: JSONContent;
  attachmentIds: string[];
};
export type AssistantThread = {
  id: string;
  integrationKey: string;
  resourceId: string | null;
  title: string;
  type: "chat" | "inline";
  settings: Record<string, unknown>;
  composerDraft: string;
  composerState?: AssistantComposerSelection;
  createdAt: string;
  updatedAt: string;
};
export type AssistantAttachment = {
  id: string;
  threadId: string;
  messageId: string | null;
  runId?: string | null;
  type: string;
  label: string;
  data: {
    url?: string;
    mimeType?: string;
    sizeBytes?: number;
    artifact?: AssistantArtifact;
    artifactSummary?: { agentId: string; summary: string; schemaVersion: number; agentVersion: number };
  };
  status: "processing" | "ready" | "failed" | "deleting";
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AssistantMessagePart =
  | { type: "text"; text: string }
  | { type: "attachment"; attachmentId: string }
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; name: string; output: unknown }
  | { type: "proposal"; proposal: AssistantProposal };
export type AssistantMessage = {
  id: string;
  threadId: string;
  runId: string | null;
  role: "user" | "assistant";
  parts: AssistantMessagePart[];
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type AssistantEvent =
  | { type: "run"; run: AssistantRun; attachments?: AssistantAttachment[] }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: AssistantProposal }
  | { type: "completed"; run: AssistantRun }
  | { type: "title"; title: string }
  | { type: "error"; message: string; run?: AssistantRun };
export type AssistantAvailability = {
  enabled: boolean;
  provider: string;
  capabilities: { images: boolean; structuredOutput: boolean; webSearch: boolean; urlRetrieval: boolean };
  reason?: string;
};
/** Models the composer picker offers; `effort` marks models that accept a reasoning effort. */
export type AssistantModels = {
  provider: string;
  defaultModel: string;
  models: { id: string; name: string; efforts: AIEffort[] }[];
};
export type AssistantExecutionSummary = {
  id: string;
  requestMessage?: string;
  agentId?: string;
  operation: string;
  executionMode: AssistantExecutionMode;
  status: AssistantRunStatus;
  label: string;
  artifact?: AssistantArtifactReference;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
};
export type AssistantThreadDetail = {
  thread: AssistantThread;
  runs: AssistantRun[];
  messages: AssistantMessage[];
  attachments: AssistantAttachment[];
  executions?: AssistantExecutionSummary[];
  executionsCursor?: string | null;
} & AssistantAvailability;
