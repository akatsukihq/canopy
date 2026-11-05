import type { AssistantComposerSelection } from "@/lib/assistant/types";

/** A slash command starts an empty token, never a URL or a filesystem path. */
export function agentSlashQuery(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)\/([a-z-]*)$/i.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() };
}

/** An `@` mention token at the caret, e.g. `@seo` while typing. Never part of an email address. */
export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([\w.-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() };
}

/** Ids of the known mentions named as `@id` in a message. */
export function mentionedIds(text: string, known: readonly string[]) {
  return [...new Set([...text.matchAll(/(?:^|\s)@([\w.-]+)/g)].map((match) => match[1].replace(/\.+$/, "")))].filter((id) =>
    known.includes(id),
  );
}

export function removeAgentSlash(text: string, token: { start: number; end: number }) {
  return { text: text.slice(0, token.start) + text.slice(token.end), caret: token.start };
}

export type ComposerSelection = AssistantComposerSelection;
export function sameComposerSelection(a: ComposerSelection, b: ComposerSelection) {
  return (
    a.agentId === b.agentId &&
    (a.agentOffset ?? 0) === (b.agentOffset ?? 0) &&
    JSON.stringify(a.content) === JSON.stringify(b.content) &&
    a.attachmentIds.length === b.attachmentIds.length &&
    a.attachmentIds.every((id, index) => id === b.attachmentIds[index])
  );
}
