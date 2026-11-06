import type { AssistantProposal, AssistantRunRequest } from "../assistant/types.ts";
import type { BlogDocument, BlogNode } from "./document.ts";

export type BlogOperation = "generate" | "chat" | "rewrite" | "agent";
export type BlogRequestSettings = {
  language?: string;
  tone?: string;
  length?: string;
  keyword?: string;
  audience?: string;
  webSearch?: boolean;
  images?: boolean;
};
export type BlogAssistantContext = {
  selectedText?: string;
  editorJson?: BlogNode;
  document?: BlogDocument;
};
export type BlogAssistantRequest = Omit<AssistantRunRequest, "operation" | "context" | "settings"> & {
  operation: BlogOperation;
  context?: BlogAssistantContext;
  settings?: BlogRequestSettings;
};
export type BlogProposalData = {
  type: "edit" | "seo";
  action?: "insert" | "replace" | "delete";
  placement?: string;
  originalText?: string;
  replacement?: BlogNode[];
  seoTitle?: string;
  seoDescription?: string;
};
export type BlogProposal = AssistantProposal & { data: BlogProposalData };
export type BlogResultData = {
  keywords: string[];
  searchStatus: "not_requested" | "completed" | "failed";
};
