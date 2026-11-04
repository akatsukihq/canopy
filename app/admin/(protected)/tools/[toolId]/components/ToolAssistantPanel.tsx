"use client";

import { useReducer, useRef } from "react";
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
    agentOperation: "agent",
    agents: [],
    resourceLabel: "This tool",
    resourceTitle: SECTION_LABEL[active],
    contextLabel: "This tool's data",
    contextDescription: "Reads this tool's saved content, definition and translations.",
    launchTitle: "Ask about SEO, content, the definition or translations.",
    placeholder: "Ask for a suggestion, alternatives or an explanation…",
    enabled: !needsLanguage,
    launchActions: [],
    contextProblem: () => (needsLanguage ? "Choose a language other than English to use the helper." : ""),
    observeRuns: (_runs, ids) => {
      fresh.current = ids;
    },
    prepareRequest: ({ message, retry }) => {
      const current = latest.current;
      return {
        input: {
          schemaVersion: 1,
          operation: "chat",
          message,
          context: {
            section: current?.section ?? section,
            ...(current?.section === "translations" && current.locale ? { locale: current.locale } : {}),
            selectedKeys: current?.section === "translations" && current.activeKey ? [current.activeKey] : [],
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
