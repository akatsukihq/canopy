"use client";

import { useReducer, useRef } from "react";
import {
  FileCode,
  Languages,
  ListChecks,
  MessageCircleQuestion,
  Search,
  SquarePen,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { mentionedIds } from "@/lib/assistant/composer";
import {
  CONTENT_FIELD_SECTION,
  TOOL_AGENTS,
  type ToolAgentId,
  type ToolContentField,
} from "@/lib/tool-framework/toolAssistantCatalog";
import { toast } from "@/components/ui/index.tsx";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import type { AssistantIntegrationUI } from "@/components/assistant/types";
import type { AssistantRun } from "@/lib/assistant/types";
import type { ToolAssistantProposalData, ToolAssistantSection } from "@/lib/tool-framework/toolAssistant";

/**
 * What the section form on screen exposes to the assistant: its live values
 * (keyed like proposals are) and the same setters typing uses. Never saves.
 */
export type AssistantTarget = {
  section: ToolAssistantSection;
  values: Record<string, unknown>;
  apply: (key: string, value: unknown) => void;
  /** Translations only. */
  locale?: string;
  activeKey?: string | null;
};

const SECTION_LABEL: Record<ToolAssistantSection, string> = {
  overview: "Overview",
  content: "Content document",
  definition: "Definition",
  translations: "Translations",
};

const AGENT_ICONS: Record<ToolAgentId, LucideIcon> = {
  seo: Search,
  content: SquarePen,
  translator: Languages,
  definition: FileCode,
};

const FIELD_LABEL: Record<ToolContentField, string> = {
  category: "Category",
  keywords: "Keywords",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  howToUse: "How to use",
  limitations: "Limitations",
  faq: "FAQs",
  examples: "Examples",
  relatedToolIds: "Related tools",
};

/** What `@` can name: content fields everywhere, plus this language's message keys on Translations. */
function mentionsFor(section: ToolAssistantSection, target: AssistantTarget | null) {
  const fields = (Object.keys(FIELD_LABEL) as ToolContentField[]).map((id) => ({
    id,
    label: FIELD_LABEL[id],
    description: `${SECTION_LABEL[CONTENT_FIELD_SECTION[id]]} · @${id}`,
  }));
  const definition = { id: "definition", label: "Definition", description: "Spec JSON · @definition" };
  if (section !== "translations" || !target) return [...fields, definition];
  const keys = Object.keys(target.values).map((id) => ({ id, label: id, description: "Translation key" }));
  return [...keys, ...fields, definition];
}

/** Starting points per section; each only drafts the message so the admin can edit it before sending. */
const STARTERS: Record<ToolAssistantSection, AssistantIntegrationUI["launchActions"]> = {
  overview: [
    {
      label: "Improve the SEO title and description",
      description: "Clearer, within length limits",
      instruction: "Suggest a better SEO title and SEO description for this tool, within the length limits.",
      icon: Search,
    },
    {
      label: "Suggest keywords",
      description: "Terms people search for this tool",
      instruction: "Suggest keywords people would search for to find this tool.",
      icon: Tags,
    },
  ],
  content: [
    {
      label: "Review the page content",
      description: "Find gaps and unclear parts",
      instruction: "Review this tool's page content. List what is missing or unclear, then suggest fixes.",
      icon: ListChecks,
    },
    {
      label: "Write FAQs",
      description: "Questions first-time users ask",
      instruction: "Suggest FAQs a first-time user of this tool would ask, with short answers.",
      icon: MessageCircleQuestion,
    },
  ],
  definition: [
    {
      label: "Explain the definition",
      description: "What each part controls",
      instruction: "Explain this tool's definition in plain language: what each part controls.",
      icon: FileCode,
    },
    {
      label: "Check for problems",
      description: "Missing limits, labels or defaults",
      instruction: "Check this tool's definition for problems such as missing limits, labels or defaults.",
      icon: ListChecks,
    },
  ],
  translations: [
    {
      label: "Translate missing strings",
      description: "Fill empty fields for this language",
      instruction: "Translate the missing strings for this language.",
      icon: Languages,
    },
    {
      label: "Review translations",
      description: "Spot wrong or awkward wording",
      instruction: "Review the existing translations for this language and point out wrong or awkward wording.",
      icon: ListChecks,
    },
  ],
};

/** The form's value for a proposal, as the proposal would replace it. */
function liveValue(target: AssistantTarget | null, data: ToolAssistantProposalData): unknown {
  if (!target) return undefined;
  if (data.kind === "content") return target.values[data.field];
  if (data.kind === "definition") return target.values.spec;
  return target.values[data.key];
}

function show(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (!Array.isArray(value)) return String(value);
  return value
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? Object.values(entry)
            .filter((part) => typeof part === "string")
            .join(" — ")
        : String(entry),
    )
    .join("\n");
}

function useIntegration(section: ToolAssistantSection, target: AssistantTarget | null): AssistantIntegrationUI {
  const [, changed] = useReducer((value) => value + 1, 0);
  const latest = useRef(target);
  latest.current = target;
  const fresh = useRef<string[]>([]);
  const consumed = useRef(new Set<string>());
  /** The field's value when its suggestion first became applicable; any later edit makes it stale. */
  const snapshots = useRef(new Map<string, string>());
  const active = target?.section ?? section;
  const needsLanguage = active === "translations" && (!target?.locale || target.locale === "en");
  return {
    key: "tool-admin",
    conversationOperation: "chat",
    // Agents only steer the same conversation, so they use the chat operation.
    agentOperation: "chat",
    agents: TOOL_AGENTS.map((agent) => ({ ...agent, icon: AGENT_ICONS[agent.id] })),
    mentions: mentionsFor(active, target),
    resourceLabel: "This tool",
    resourceTitle: SECTION_LABEL[active],
    contextLabel: "This tool's data",
    contextDescription: "Reads this tool's saved content, definition and translations.",
    launchTitle: "Ask about SEO, content, the definition or translations.",
    placeholder: "Ask for a suggestion, alternatives or an explanation…",
    enabled: !needsLanguage,
    attachments: false,
    launchActions: STARTERS[active],
    contextProblem: () => (needsLanguage ? "Choose a language other than English to use the helper." : ""),
    observeRuns: (_runs, ids) => {
      fresh.current = ids;
    },
    prepareRequest: ({ message, retry, agentId }) => {
      const current = latest.current;
      const mentions = mentionedIds(
        message,
        mentionsFor(current?.section ?? section, current).map((entry) => entry.id),
      );
      return {
        input: {
          schemaVersion: 1,
          operation: "chat",
          ...(agentId ? { agentId } : {}),
          message,
          context: {
            section: current?.section ?? section,
            ...(current?.section === "translations" && current.locale ? { locale: current.locale } : {}),
            selectedKeys: current?.section === "translations" && current.activeKey ? [current.activeKey] : [],
            ...(mentions.length ? { mentions } : {}),
          },
          ...(retry?.inputMessageId ? { inputMessageId: retry.inputMessageId } : {}),
          settings: {},
        },
      };
    },
    response: (run: AssistantRun, message, isFresh) => {
      if (isFresh && !fresh.current.includes(run.id)) fresh.current.push(run.id);
      const proposals = message.parts.filter((part) => part.type === "proposal").map((part) => part.proposal);
      return {
        changes: proposals.map((proposal) => {
          const data = proposal.data as ToolAssistantProposalData;
          const id = `${run.id}:${proposal.id}`;
          const now = latest.current;
          const actionable =
            fresh.current.includes(run.id) && !consumed.current.has(id) && proposal.status === "pending";
          const live = liveValue(now, data);
          const onSection =
            now?.section === data.section && (data.kind !== "translation" || now.locale === data.locale);
          let blockedReason: string | undefined;
          if (data.error) blockedReason = `Can't apply: ${data.error}`;
          else if (!onSection)
            blockedReason =
              data.kind === "translation" && now?.section === "translations"
                ? `Switch the language to ${data.locale} to apply this.`
                : `Open ${SECTION_LABEL[data.section]} to apply this.`;
          else if (data.kind === "definition") {
            if (live !== data.previous) blockedReason = "The definition changed since the suggestion. Ask again.";
          } else {
            const serialized = JSON.stringify(live ?? "");
            if (!snapshots.current.has(id)) snapshots.current.set(id, serialized);
            if (snapshots.current.get(id) !== serialized)
              blockedReason = "This field changed since the suggestion. Ask again.";
          }
          const title = data.kind === "content" ? data.field : data.kind === "definition" ? "definition" : data.key;
          return {
            id,
            kind: "replace" as const,
            title,
            placement:
              data.note ??
              (data.kind === "definition"
                ? "Replaces the editor text; Save draft to keep it"
                : `Fills the field only; save to keep it (${SECTION_LABEL[data.section]})`),
            before:
              data.kind === "definition"
                ? data.previous
                : onSection
                  ? show(live)
                  : data.kind === "translation"
                    ? data.previous
                    : "",
            after: data.kind === "content" ? data.display : data.text,
            compact: proposals.length > 1,
            actionable,
            stale: !!blockedReason,
            blockedReason,
            actionLabel: data.kind === "definition" ? "Fill editor" : "Fill field",
            onApply: () => {
              if (blockedReason || !now) throw new Error(blockedReason ?? "Open the section first.");
              if (data.kind === "content") now.apply(data.field, data.value);
              else if (data.kind === "definition") now.apply("spec", data.text);
              else now.apply(data.key, data.text);
              consumed.current.add(id);
              changed();
              toast.success("Added to the form. Save it to keep the change.");
            },
            onDiscard: () => {
              consumed.current.add(id);
              changed();
            },
          };
        }),
      };
    },
    artifact: (attachment) => ({
      supported: false,
      text: JSON.stringify(attachment.data),
      report: { sections: [] },
    }),
    executionStale: () => false,
  };
}

export function ToolAssistantPanel({
  onClose,
  ownerId,
  section,
  target,
  toolId,
}: {
  onClose: () => void;
  ownerId: string;
  section: ToolAssistantSection;
  target: AssistantTarget | null;
  toolId: string;
}) {
  const integration = useIntegration(section, target);
  return (
    <AssistantPanel
      key={`${ownerId}:tool-admin:${toolId}`}
      resourceId={toolId}
      ownerId={ownerId}
      integration={integration}
      onClose={onClose}
    />
  );
}
