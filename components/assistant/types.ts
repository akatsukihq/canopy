import type { AIEffort } from "@/lib/ai/types";
import type { LucideIcon } from "lucide-react";
import type {
  AssistantAttachment,
  AssistantRun,
  AssistantRunRequest,
  AssistantMessage,
  AssistantExecutionSummary,
} from "@/lib/assistant/types";

export type AssistantAgent = {
  id: string;
  name: string;
  command: string;
  aliases: readonly string[];
  description: string;
  requiresContext?: boolean;
  icon?: LucideIcon;
  /** Reasoning effort the server uses for this agent unless the user picks one. */
  effort?: AIEffort;
};
export type ReportSection = {
  heading: string;
  text?: string;
  items?: string[];
  entries?: Array<{ title: string; label?: string; text?: string }>;
  findings?: Array<{ severity: "high" | "medium" | "low"; issue: string; passage: string; recommendation: string }>;
  links?: Array<{ url: string; title: string }>;
  /** Exact data (e.g. raw JSON), shown collapsed behind the heading as highlighted code. */
  code?: { language: string; value: string };
};
export type ReportModel = { summary?: string; sections: ReportSection[] };
export type ChangeModel = {
  id: string;
  kind: "insert" | "replace" | "delete";
  title: string;
  placement: string;
  before: string;
  after: string;
  compact: boolean;
  actionable: boolean;
  stale: boolean;
  blockedReason?: string;
  actionLabel: string;
  onApply: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
};
export type ChangesetModel = {
  title: string;
  description: string;
  staleLabel?: string;
  previewLabel: string;
  applyLabel: string;
  keepLabel: string;
  contentTitle: string;
  introduction?: string;
  html?: string;
  text?: string;
  sections?: ReportSection[];
  eligibility: () => { stale: boolean; alreadyApplied: boolean; canUndo: boolean; hasUndo: boolean; expired: boolean };
  onApply: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
};
export type ArtifactModel = {
  supported: boolean;
  text: string;
  report: ReportModel;
  stale?: boolean;
  document?: { title: string; html?: string; text?: string };
  changeset?: ChangesetModel;
  handoff?: { agentId?: string; label: string; instruction: string };
};
export type AssistantIntegrationUI = {
  key: string;
  conversationOperation: string;
  agentOperation: string;
  selectSettings?: readonly { key: string; label: string; options: readonly string[] }[];
  agents: readonly AssistantAgent[];
  initialAgentId?: string;
  resourceLabel: string;
  resourceTitle: string;
  contextLabel: string;
  contextDescription: string;
  launchTitle: string;
  placeholder: string;
  enabled: boolean;
  /** Without an agent, a launch action only drafts its instruction into the composer. */
  launchActions: Array<{
    agentId?: string;
    label: string;
    description: string;
    instruction?: string;
    icon: LucideIcon;
  }>;
  /** False hides the attach menu for integrations that read only their own data. */
  attachments?: boolean;
  /** Things the admin can name with `@`; picking one inserts `@id` into the message. */
  mentions?: readonly { id: string; label: string; description?: string }[];
  markdown?: { minimumHeadingLevel?: 1 | 2; breaks?: boolean };
  contextProblem: (agentId: string | undefined, message: string, includeContext: boolean) => string;
  prepareRequest: (input: {
    operation: string;
    agentId?: string;
    message: string;
    retry?: AssistantRun;
    includeContext: boolean;
    settings: Record<string, unknown>;
    attachmentIds: string[];
  }) => {
    input: Omit<AssistantRunRequest, "threadId" | "clientRequestId" | "resourceId">;
    onCreated?: (run: AssistantRun) => void;
    dispose?: () => void;
  };
  observeRuns?: (runs: AssistantRun[], freshRunIds: string[]) => void;
  response: (
    run: AssistantRun,
    message: AssistantMessage,
    fresh: boolean,
  ) => { report?: ReportModel; warning?: string; note?: string; changes: ChangeModel[] };
  artifact: (attachment: AssistantAttachment, html?: string) => ArtifactModel;
  executionStale: (execution: AssistantExecutionSummary) => boolean;
};
