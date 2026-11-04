"use client";

import { useReducer, useRef } from "react";
import { toast } from "@/components/ui/index.tsx";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import type { AssistantIntegrationUI } from "@/components/assistant/types";
import type { AssistantRun } from "@/lib/assistant/types";
import type { ToolTranslationProposalData } from "@/lib/tool-framework/translationAssistant";
import type { ToolMessages } from "@/lib/tool-framework/translations";

type Props = {
  toolId: string;
  ownerId: string;
  locale: string;
  english: ToolMessages;
  messages: ToolMessages;
  /** The field the admin last focused; sent as the "selected" field. */
  activeKey: string | null;
  /** Same path as typing in the field, so chip editors and hidden inputs stay in sync. Never saves. */
  onApply: (key: string, value: string) => void;
  onClose: () => void;
};

function useIntegration({ locale, english, messages, activeKey, onApply }: Props): AssistantIntegrationUI {
  const [, changed] = useReducer((value) => value + 1, 0);
  const latest = useRef({ locale, messages });
  latest.current = { locale, messages };
  const fresh = useRef<string[]>([]);
  const consumed = useRef(new Set<string>());
  return {
    key: "tool-translations",
    conversationOperation: "chat",
    agentOperation: "agent",
    agents: [],
    resourceLabel: "This tool",
    resourceTitle: locale === "en" ? "Choose a language" : `Translating to ${locale}`,
    contextLabel: "This tool's messages",
    contextDescription: "Uses this tool's English text and your current translations.",
    launchTitle: "Translate with a second pair of eyes.",
    placeholder: "Ask for a suggestion, alternatives or an explanation…",
    enabled: locale !== "en",
    launchActions: [],
    contextProblem: () => (locale === "en" ? "Switch to a language other than English to use the helper." : ""),
    observeRuns: (_runs, ids) => {
      fresh.current = ids;
    },
    prepareRequest: ({ message, retry }) => ({
      input: {
        schemaVersion: 1,
        operation: "chat",
        message,
        context: {
          locale,
          english,
          current: Object.fromEntries(Object.entries(messages).filter(([key, value]) => key in english && value)),
          selectedKeys: activeKey && activeKey in english ? [activeKey] : [],
        },
        ...(retry?.inputMessageId ? { inputMessageId: retry.inputMessageId } : {}),
        settings: {},
      },
    }),
    response: (run: AssistantRun, message, isFresh) => {
      if (isFresh && !fresh.current.includes(run.id)) fresh.current.push(run.id);
      const proposals = message.parts.filter((part) => part.type === "proposal").map((part) => part.proposal);
      return {
        changes: proposals.map((proposal) => {
          const data = proposal.data as ToolTranslationProposalData;
          const id = `${run.id}:${proposal.id}`;
          const actionable =
            fresh.current.includes(run.id) && !consumed.current.has(id) && proposal.status === "pending";
          const requestLocale = (run.request.context as { locale?: string } | undefined)?.locale;
          const blockedReason = data.error
            ? `Can't apply: ${data.error}`
            : requestLocale !== latest.current.locale || (latest.current.messages[data.key] ?? "") !== data.previous
              ? "This field changed since the suggestion. Ask again."
              : undefined;
          return {
            id,
            kind: "replace" as const,
            title: data.key,
            placement: data.note ?? "Fills the field only; save the draft to keep it",
            before: data.previous,
            after: data.text,
            compact: proposals.length > 1,
            actionable,
            stale: !!blockedReason,
            blockedReason,
            actionLabel: "Fill field",
            onApply: () => {
              if (blockedReason) throw new Error(blockedReason);
              onApply(data.key, data.text);
              consumed.current.add(id);
              changed();
              toast.success("Added to the form. Save the draft to keep it.");
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

export function ToolTranslationAssistantPanel(props: Props) {
  const integration = useIntegration(props);
  return (
    <AssistantPanel
      key={`${props.ownerId}:tool-translations:${props.toolId}`}
      resourceId={props.toolId}
      ownerId={props.ownerId}
      integration={integration}
      onClose={props.onClose}
    />
  );
}
