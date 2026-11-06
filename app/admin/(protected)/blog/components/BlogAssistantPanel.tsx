"use client";
import type { Editor } from "@tiptap/core";
import type { BlogDocument } from "@/lib/blog/document";
import type { AgentSummary } from "@/lib/agents/types";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { useBlogAssistantIntegration } from "../lib/useBlogAssistantIntegration";
export function BlogAssistantPanel(props: {
  postId: string;
  ownerId: string;
  editor: Editor | null;
  document: BlogDocument;
  initialReview?: boolean;
  agents: AgentSummary[];
  onClose?: () => void;
  onReplaceDocument: (document: BlogDocument) => void;
  onMetadata: (field: "seoTitle" | "seoDescription", value: string) => void;
}) {
  const integration = useBlogAssistantIntegration(props);
  return (
    <AssistantPanel
      key={`${props.ownerId}:blog:${props.postId}`}
      resourceId={props.postId}
      ownerId={props.ownerId}
      integration={integration}
      onClose={props.onClose}
    />
  );
}
