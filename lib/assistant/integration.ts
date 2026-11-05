import type { db, assistantRunsTable, assistantMessagesTable, assistantAttachmentsTable } from "../../db/index.ts";
import type { AIEffort, AIRequest, AIResult } from "../ai/types.ts";
import type {
  AssistantArtifact,
  AssistantExecutionMode,
  AssistantMessage,
  AssistantProposal,
  AssistantResult,
  AssistantRunRequest,
} from "./types.ts";

export type AssistantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StoredRun = typeof assistantRunsTable.$inferSelect;
export type StoredMessage = typeof assistantMessagesTable.$inferSelect;
export type StoredAttachment = typeof assistantAttachmentsTable.$inferSelect;
export type AssistantCompletion = {
  response: AssistantResult;
  artifact?: { label: string; value: AssistantArtifact; reference?: Record<string, unknown> };
  resourceData?: unknown;
};
export type AuxiliaryResult = Partial<Pick<AIResult, "id" | "model" | "usage">>;
/** Features describe execution and domain policy; core owns lifecycle and persistence. */
/** One agent call. `next` chains another agent from this one's result; the last result completes the run. */
export type AssistantStageRequest = AIRequest & {
  /** Plain-language step label shown while this agent works. */
  stage?: string;
  next?: (result: AIResult) => AssistantStageRequest | undefined;
};

export interface AssistantIntegration {
  key: string;
  defaultSettings: Record<string, unknown>;
  validateSettings(value: unknown): Record<string, unknown>;
  validateRequest(value: AssistantRunRequest): AssistantRunRequest;
  operation(request: AssistantRunRequest): {
    executionMode: AssistantExecutionMode;
    threadType: "chat" | "inline";
    includeHistory: boolean;
    structuredOutput: boolean;
  };
  operationLabel(operation: string, agentId?: string): string;
  /** Reasoning effort used when the user leaves the picker on its default; medium otherwise. */
  agentEffort?(agentId?: string): AIEffort | undefined;
  authorize(
    tx: AssistantTransaction,
    actor: string,
    resourceId: string | null,
    edit: boolean,
    operation?: string,
  ): Promise<void>;
  authorizeConfiguration(actor: string): Promise<void>;
  reserveResource?(tx: AssistantTransaction, actor: string, request: AssistantRunRequest): Promise<string | undefined>;
  retryRequest(original: AssistantRunRequest, incoming: AssistantRunRequest): AssistantRunRequest;
  isArtifact(value: unknown): value is AssistantArtifact;
  artifactDetail(value: AssistantArtifact): { html?: string };
  buildRequest(input: {
    run: StoredRun;
    history: AssistantMessage[];
    attachments: StoredAttachment[];
    proposals: AssistantProposal[];
    signal: AbortSignal;
  }): AssistantStageRequest | Promise<AssistantStageRequest>;
  partialText?(output: unknown, request: AssistantRunRequest): string | undefined;
  validateResult(
    result: AIResult,
    request: AssistantRunRequest,
    proposals: AssistantProposal[],
    inputArtifactIds: string[],
  ): AssistantCompletion;
  complete?(tx: AssistantTransaction, run: StoredRun, completion: AssistantCompletion): Promise<void>;
  auxiliary?(
    run: StoredRun,
    signal: AbortSignal,
    authorize: (tx: AssistantTransaction) => Promise<StoredRun>,
  ): Promise<AuxiliaryResult | undefined>;
}
