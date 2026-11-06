"use client";
import { useEffect, useRef, useReducer } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { NotebookPen, ListChecks, ScanSearch, ScanText, Sparkles, SquarePen } from "lucide-react";
import { toast } from "@/components/ui/index.tsx";
import type { BlogDocument, BlogNode } from "@/lib/blog/document";
import type { AssistantRun, AssistantProposal, AssistantRunRequest } from "@/lib/assistant/types";
import type { BlogAssistantContext, BlogProposalData, BlogResultData } from "@/lib/blog/assistantTypes";
import type { AssistantIntegrationUI, ReportModel, ChangeModel } from "@/components/assistant/types";
import { BLOG_AGENTS } from "@/lib/blog/agentCatalog";
import {
  supportedArtifact,
  agentDocumentFingerprint,
  agentReplacement,
  sameAgentDocument,
  type BlogArtifact,
} from "@/lib/blog/agentArtifacts";
import {
  captureAssistantSelection,
  captureAssistantInsertion,
  canCaptureAssistantInsertion,
  findAssistantPassage,
  assistantBodyMatches,
} from "./assistantSelection";
const LAUNCH_ACTIONS = [
  { agentId: "planner", label: "Plan & write", description: "Turn an idea into a first draft", icon: NotebookPen },
  {
    agentId: "auditor",
    label: "Audit this draft",
    description: "Find gaps, unclear sections, and fixes",
    icon: ListChecks,
  },
  {
    agentId: "optimizer",
    label: "Optimize for SEO",
    description: "Improve titles, structure, and keywords",
    icon: ScanSearch,
  },
  {
    agentId: "auditor",
    label: "Check originality",
    description: "Check for matches and verify sources",
    icon: ScanText,
    instruction:
      "Review this draft for originality and source attribution using the attached references. Flag matching passages, missing citations, and claims that need verification. Clearly state what could not be checked; do not claim a comprehensive plagiarism scan.",
  },
];
function plain(nodes: JSONContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "hardBreak") return "\n";
      if (node.type === "image") return `[Image: ${String(node.attrs?.alt ?? "")}]\n`;
      const text = plain(node.content ?? []);
      return ["paragraph", "heading", "codeBlock", "listItem"].includes(node.type ?? "") ? `${text}\n` : text;
    })
    .join("");
}

function nodeText(node: BlogNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? [])
    .map(nodeText)
    .join(["doc", "table", "tableRow", "bulletList", "orderedList"].includes(node.type) ? "\n" : "");
}
export function readableArtifact(artifact: BlogArtifact) {
  const content = artifact.content;
  return [
    artifact.summary,
    ...(content.document
      ? [
          content.document.title,
          content.document.excerpt,
          nodeText(content.document.body),
          `SEO title: ${content.document.seoTitle ?? ""}`,
          `SEO description: ${content.document.seoDescription ?? ""}`,
        ]
      : []),
    ...(content.sections ?? []).map((section) =>
      [
        section.heading,
        section.text,
        ...(section.items ?? []),
        ...(section.findings ?? []).map(
          (finding) => `${finding.severity}: ${finding.issue}\n${finding.passage}\n${finding.recommendation}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    content.searchIntent,
    ...(content.keywords ?? []).map((item) => `${item.keyword} (${item.kind}): ${item.rationale}`),
    ...(content.changes ?? []),
    ...(content.remainingTasks ?? []),
    ...(content.citations ?? []).map((citation) => `${citation.title}: ${citation.url}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function report(artifact: BlogArtifact): ReportModel {
  const content = artifact.content;
  return {
    summary: artifact.summary,
    sections: [
      ...(content.searchIntent ? [{ heading: "Search intent", text: content.searchIntent }] : []),
      ...(content.sections ?? []),
      ...(content.keywords?.length
        ? [
            {
              heading: "Suggested keywords",
              entries: content.keywords.map((item) => ({
                title: item.keyword,
                label: item.kind,
                text: item.rationale,
              })),
            },
          ]
        : []),
      ...(content.changes?.length ? [{ heading: "Proposed changes", items: content.changes }] : []),
      ...(content.remainingTasks?.length ? [{ heading: "Remaining tasks", items: content.remainingTasks }] : []),
      ...(content.citations?.length ? [{ heading: "Evidence", links: content.citations }] : []),
    ],
  };
}
export function useBlogAssistantIntegration({
  editor,
  document,
  onReplaceDocument,
  onMetadata,
  initialReview,
}: {
  editor: Editor | null;
  document: BlogDocument;
  onReplaceDocument: (document: BlogDocument) => void | Promise<void>;
  onMetadata: (field: "seoTitle" | "seoDescription", value: string) => void;
  initialReview?: boolean;
}): AssistantIntegrationUI {
  const [, changed] = useReducer((value) => value + 1, 0);
  const targets = useRef(new Map<string, ReturnType<typeof captureAssistantSelection>>());
  const consumed = useRef(new Set<string>());
  const metadataSnapshots = useRef(new Map<string, Pick<BlogDocument, "seoTitle" | "seoDescription">>());
  const fresh = useRef<string[]>([]);
  const current = useRef(document);
  current.current = document;
  const replacements = useRef(new Map<string, { before: BlogDocument; after: BlogDocument }>());
  const contextFor = (run: AssistantRun): BlogAssistantContext => (run.request.context ?? {}) as BlogAssistantContext;
  const bodyChanged = (run: AssistantRun) => !editor || !assistantBodyMatches(editor, contextFor(run).editorJson);
  const reportChanged = bodyChanged;
  const seoChanged = (run: AssistantRun, field: "seoTitle" | "seoDescription") => {
    const captured = metadataSnapshots.current.get(run.id);
    return !captured || current.current[field] !== captured[field];
  };
  useEffect(
    () => () => {
      for (const target of targets.current.values()) target.dispose();
    },
    [],
  );
  function targetFor(run: AssistantRun, proposal: AssistantProposal, create = false) {
    const data = proposal.data as BlogProposalData;
    const key = `${run.id}:${contextFor(run).selectedText ? "selection" : proposal.id}`;
    const tracked = targets.current.get(key);
    if (tracked) return tracked;
    if (!editor || (!contextFor(run).selectedText && bodyChanged(run))) return null;
    if (data.action === "insert" && !data.originalText) {
      if (!canCaptureAssistantInsertion(editor)) return null;
      if (!create) return { valid: () => true, apply: () => false };
      const target = captureAssistantInsertion(editor);
      if (target) targets.current.set(key, target);
      return target;
    }
    const range =
      contextFor(run).selectedText || data.originalText
        ? findAssistantPassage(editor, contextFor(run).selectedText ?? data.originalText!)
        : null;
    if (
      !range ||
      range.from < 0 ||
      range.to > editor.state.doc.content.size ||
      range.from >= range.to ||
      editor.state.doc.textBetween(range.from, range.to, "\n") !== (contextFor(run).selectedText ?? data.originalText)
    )
      return null;
    if (!create) return { valid: () => true, apply: () => false };
    const target = captureAssistantSelection(editor, { ...editor.state.selection, ...range });
    targets.current.set(key, target);
    return target;
  }
  function dismissProposal(key: string) {
    consumed.current.add(key);
    changed();
  }
  function apply(run: AssistantRun, proposal: AssistantProposal) {
    const data = proposal.data as BlogProposalData;
    const key = `${run.id}:${proposal.id}`;
    if (consumed.current.has(key) || !fresh.current.includes(run.id)) return;
    try {
      if (data.type === "seo") {
        const field = data.seoTitle !== undefined ? "seoTitle" : "seoDescription";
        if (reportChanged(run) || seoChanged(run, field)) {
          throw new Error("This SEO field changed. Run a fresh review before applying it.");
        }
        const value = data[field];
        if (value === undefined) return;
        onMetadata(field, value);
      } else {
        const target = targetFor(run, proposal, true);
        const action = data.action ?? "replace";
        if (
          !target?.valid() ||
          !target.apply(data.replacement ? { type: "doc", content: data.replacement } : undefined, action)
        ) {
          throw new Error("This section changed. Ask for a fresh suggestion.");
        }
      }
      dismissProposal(key);
      toast.success("Applied to your draft. Use Save draft to confirm it is saved.");
    } catch (cause) {
      throw cause;
    }
  }
  function change(run: AssistantRun, proposal: AssistantProposal, compact: boolean): ChangeModel {
    const data = proposal.data as BlogProposalData;
    const key = `${run.id}:${proposal.id}`;
    const actionable = fresh.current.includes(run.id) && !consumed.current.has(key) && proposal.status === "pending";
    const kind = data.action ?? "replace";
    const seoField = data.seoTitle !== undefined ? "seoTitle" : "seoDescription";
    const stale =
      actionable &&
      (data.type === "edit" ? !targetFor(run, proposal)?.valid() : reportChanged(run) || seoChanged(run, seoField));
    const before =
      data.type === "seo" ? (metadataSnapshots.current.get(run.id)?.[seoField] ?? "") : (data.originalText ?? "");
    const after = data.type === "seo" ? (data[seoField] ?? "") : plain(data.replacement ?? []).trim();
    const title =
      proposal.title ??
      (data.type === "seo"
        ? seoField === "seoTitle"
          ? "Improve the SEO title"
          : "Improve the SEO description"
        : kind === "insert"
          ? "Add a new section"
          : kind === "delete"
            ? "Remove this section"
            : "Improve this section");
    const placement =
      data.placement ??
      (data.type === "seo"
        ? seoField === "seoTitle"
          ? "SEO title"
          : "SEO description"
        : contextFor(run).selectedText
          ? "selected passage"
          : kind === "insert" && !before
            ? "start of the draft"
            : "in the draft");
    return {
      id: key,
      kind,
      title,
      placement,
      before,
      after,
      compact,
      actionable,
      stale,
      actionLabel:
        data.type === "seo"
          ? seoField === "seoTitle"
            ? "Apply title"
            : "Apply description"
          : kind === "insert"
            ? "Insert section"
            : kind === "delete"
              ? "Delete section"
              : "Apply edit",
      onApply: () => apply(run, proposal),
      onDiscard: () => dismissProposal(key),
    };
  }

  return {
    key: "blog",
    conversationOperation: "chat",
    agentOperation: "agent",
    selectSettings: [
      { key: "tone", label: "Tone", options: ["From your idea", "Professional", "Conversational", "Educational"] },
    ],
    agents: BLOG_AGENTS.map((agent) => ({
      ...agent,
      requiresContext: agent.requiresDocument,
      icon: { planner: NotebookPen, writer: SquarePen, auditor: ScanSearch, optimizer: Sparkles }[agent.id],
    })),
    initialAgentId: initialReview ? "auditor" : undefined,
    resourceLabel: "This blog",
    resourceTitle: document.title || "Untitled blog",
    contextLabel: "Current blog",
    contextDescription: "Use your article as context for the next message.",
    launchTitle: "Make your next draft better.",
    placeholder: "Ask about this blog…",
    enabled: !!editor,
    launchActions: LAUNCH_ACTIONS,
    markdown: { minimumHeadingLevel: 2, breaks: true },
    contextProblem: (agentId, message, includeContext) =>
      ["auditor", "optimizer"].includes(agentId ?? "") && !editor?.getText().trim()
        ? "Write some article content before running this agent."
        : agentId === "planner" && !message.trim() && (!includeContext || !editor?.getText().trim())
          ? "Describe the topic you want to plan."
          : "",
    observeRuns: (runs, ids) => {
      fresh.current = ids;
      if (!editor) return;
      for (const run of runs) {
        if (run.status !== "completed" || !ids.includes(run.id) || contextFor(run).selectedText || bodyChanged(run))
          continue;
        for (const proposal of run.response?.proposals ?? [])
          if (proposal.data.type === "edit") targetFor(run, proposal, true);
      }
    },
    prepareRequest: ({ operation, agentId, message, retry, includeContext, settings, attachmentIds }) => {
      if (!editor) throw new Error("The editor is unavailable.");
      const previous = retry;
      const previousContext = previous ? contextFor(previous) : undefined;
      const previousTarget = previous ? targets.current.get(`${previous.id}:selection`) : null;
      const restoredRange = previousContext?.selectedText
        ? findAssistantPassage(editor, previousContext.selectedText)
        : null;
      const range =
        operation === "chat" || operation === "rewrite"
          ? (previousTarget?.range ??
            (restoredRange && previousContext?.selectedText
              ? { ...restoredRange, text: previousContext.selectedText }
              : undefined))
          : undefined;
      if (!range && operation === "rewrite")
        throw new Error("This passage changed. Select it again before improving it.");
      const target = range ? captureAssistantSelection(editor, { ...editor.state.selection, ...range }) : null;
      const request: AssistantRunRequest = {
        schemaVersion: 1,
        clientRequestId: "",
        operation: range && operation === "chat" ? "rewrite" : operation,
        message,
        ...(operation === "agent" ? { agentId } : {}),
        context:
          operation === "agent"
            ? includeContext
              ? { document: { ...current.current, body: editor.getJSON() as BlogDocument["body"] } }
              : {}
            : range
              ? { selectedText: range.text }
              : {
                  editorJson:
                    previousContext?.editorJson ??
                    (includeContext
                      ? (editor.getJSON() as BlogDocument["body"])
                      : { type: "doc", content: [{ type: "paragraph" }] }),
                },
        ...(previous?.inputMessageId ? { inputMessageId: previous.inputMessageId } : {}),
        settings,
        attachmentIds,
      };
      const { clientRequestId: _key, ...input } = request;
      return {
        input,
        onCreated: (run) => {
          metadataSnapshots.current.set(run.id, {
            seoTitle: current.current.seoTitle,
            seoDescription: current.current.seoDescription,
          });
          if (target) targets.current.set(`${run.id}:selection`, target);
        },
        dispose: () => target?.dispose(),
      };
    },
    response: (run, message, isFresh) => {
      if (isFresh && !fresh.current.includes(run.id)) fresh.current.push(run.id);
      const proposals = message.parts.filter((part) => part.type === "proposal").map((part) => part.proposal);
      const response = run.response;
      const data = response?.data as BlogResultData | undefined;
      return {
        report: {
          sections: [
            ...(data?.keywords.length ? [{ heading: "Suggested keywords", text: data.keywords.join(", ") }] : []),
            ...(response?.citations.length ? [{ heading: "Sources", links: response.citations }] : []),
          ],
        },
        changes: proposals.map((proposal) => change(run, proposal, proposals.length > 1)),
      };
    },
    executionStale: (execution) =>
      !!execution.artifact?.baseDocumentFingerprint &&
      execution.artifact.baseDocumentFingerprint !== agentDocumentFingerprint(current.current),
    artifact: (attachment, html) => {
      const artifact = attachment.data.artifact;
      if (!supportedArtifact(artifact))
        return { supported: false, text: JSON.stringify(attachment.data, null, 2), report: { sections: [] } };
      const proposal = artifact.content.document;
      const content = report(artifact);
      const nextAgent =
        artifact.agentId === "planner" ? "writer" : artifact.agentId === "auditor" ? "optimizer" : undefined;
      return {
        supported: true,
        text: readableArtifact(artifact),
        report: content,
        stale:
          !!artifact.baseDocumentFingerprint &&
          artifact.baseDocumentFingerprint !== agentDocumentFingerprint(current.current),
        document: proposal ? { title: proposal.title, html, text: nodeText(proposal.body) } : undefined,
        handoff: {
          agentId: nextAgent,
          label: nextAgent
            ? `Use with ${BLOG_AGENTS.find((agent) => agent.id === nextAgent)?.name}`
            : "Attach to composer",
          instruction:
            nextAgent === "writer"
              ? "Write a complete article using this plan."
              : nextAgent === "optimizer"
                ? "Optimize this blog using the attached audit."
                : "Use the attached result to ",
        },
        changeset: proposal
          ? {
              staleLabel: "Draft changed · run again",
              title: "Preview complete draft",
              previewLabel: "Preview complete draft",
              applyLabel: "Replace draft",
              keepLabel: "Keep current draft",
              description:
                "Replacing updates the title, article, excerpt and SEO metadata. Publication settings stay unchanged.",
              contentTitle: proposal.title,
              introduction: proposal.excerpt,
              html,
              sections: [
                {
                  heading: "Search preview",
                  text: `${proposal.seoTitle || proposal.title}\n${proposal.seoDescription || proposal.excerpt}`,
                },
                ...content.sections,
              ],
              eligibility: () => {
                const replacement = replacements.current.get(attachment.id);
                return {
                  alreadyApplied: sameAgentDocument(current.current, proposal),
                  stale: artifact.baseDocumentFingerprint !== agentDocumentFingerprint(current.current),
                  expired: !!attachment.expiresAt && Date.parse(attachment.expiresAt) <= Date.now(),
                  hasUndo: !!replacement,
                  canUndo: !!replacement && sameAgentDocument(current.current, replacement.after),
                };
              },
              onApply: async () => {
                if (attachment.expiresAt && Date.parse(attachment.expiresAt) <= Date.now())
                  throw new Error("This result expired. Prepare a fresh request.");
                const before = current.current;
                const after = agentReplacement(artifact, before);
                await onReplaceDocument(after);
                replacements.current.set(attachment.id, { before, after });
                toast.success("Draft replaced. Your existing save settings apply.");
              },
              onUndo: async () => {
                const replacement = replacements.current.get(attachment.id);
                if (!replacement || !sameAgentDocument(current.current, replacement.after))
                  throw new Error("Newer edits prevent undo.");
                const { title, excerpt, body, seoTitle, seoDescription } = replacement.before;
                await onReplaceDocument({ ...current.current, title, excerpt, body, seoTitle, seoDescription });
                replacements.current.delete(attachment.id);
                toast.success("Replacement undone.");
              },
            }
          : undefined,
      };
    },
  };
}
