/** Server-only: turns a blog editor agent's result into a stored artifact with the section's own checks. */
import "server-only";
import { agentOutputZod } from "../agents/compile.ts";
import type { Agent } from "../agents/types.ts";
import type { AIResult } from "../ai/types.ts";
import { publicReference } from "../assistant/validation.ts";
import {
  agentArtifactContent,
  agentDocumentFingerprint,
  serializeAgentValue,
  type BlogArtifact,
} from "./agentArtifacts.ts";
import type { BlogAssistantRequest } from "./assistantTypes.ts";
import { blogDocumentText, validateBlogDocument, type BlogDocument, type BlogNode } from "./document.ts";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function preservedNodes(node: BlogNode): string[] {
  const result: string[] = [];
  const visit = (value: BlogNode) => {
    if (["image", "table", "codeBlock", "inlineMath", "blockMath"].includes(value.type)) {
      result.push(serializeAgentValue(value));
      return;
    }
    for (const mark of value.marks ?? [])
      if (mark.type === "link") result.push(serializeAgentValue({ text: value.text, mark }));
    for (const child of value.content ?? []) visit(child);
  };
  visit(node);
  return result;
}

export function assertProtectedContent(before: BlogDocument, after: BlogDocument) {
  const internalLinks = (root: BlogNode) => {
    const urls = new Set<string>();
    const visit = (node: BlogNode) => {
      for (const mark of node.marks ?? [])
        if (mark.type === "link" && mark.attrs.href.startsWith("/")) urls.add(mark.attrs.href);
      for (const child of node.content ?? []) visit(child);
    };
    visit(root);
    return urls;
  };
  const existing = internalLinks(before.body);
  if ([...internalLinks(after.body)].some((url) => !existing.has(url)))
    throw new Error(
      "The proposed draft introduced an unverified internal link. Ask the agent to list it as a remaining task instead.",
    );
  const output = preservedNodes(after.body);
  for (const value of preservedNodes(before.body)) {
    const at = output.indexOf(value);
    if (at < 0)
      throw new Error("The proposed draft did not preserve existing rich content or links. Run the agent again.");
    output.splice(at, 1);
  }
}

function parseAgentBody(bodyJson: string): unknown {
  // Repair common model heading encodings only; the full document is still validated below.
  return JSON.parse(bodyJson, (_key: string, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const node = value as Record<string, unknown>;
    if (node.type !== "heading") return value;
    const attrs = node.attrs === undefined ? {} : node.attrs;
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return value;
    const rawLevel = (attrs as Record<string, unknown>).level;
    const level =
      rawLevel == null ? 2 : typeof rawLevel === "string" && /^[1-6]$/.test(rawLevel) ? Number(rawLevel) : rawLevel;
    return { ...node, attrs: { ...attrs, level: level === 1 ? 2 : level } };
  });
}

/** True when the agent's own schema asks it to list its changes. */
function schemaListsChanges(agent: Agent): boolean {
  const properties = agent.outputSchema?.properties as Record<string, { type?: unknown }> | undefined;
  return properties?.changes?.type === "array";
}

type ProposedDocument = { bodyJson: string } & Record<string, unknown>;

function proposedDraft(proposed: ProposedDocument | null | undefined, base: BlogDocument | undefined): BlogDocument {
  if (!proposed) throw new Error("The agent did not return a complete draft preview.");
  if (!base) throw new Error("Attach the current blog to this agent.");
  const { bodyJson, ...fields } = proposed;
  const document = validateBlogDocument({ ...base, ...fields, body: parseAgentBody(bodyJson) });
  if (!blogDocumentText(document).trim()) throw new Error("The agent returned an empty draft.");
  assertProtectedContent(base, document);
  return document;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * Validates the agent's output against its configured schema (the agent's own completeness rules live
 * there), then applies the section's checks to any proposed draft.
 */
export function agentArtifact(
  agent: Agent,
  result: AIResult,
  request: BlogAssistantRequest,
  inputArtifactIds: string[],
): { label: string; artifact: BlogArtifact } {
  const schema = agentOutputZod(agent);
  const raw = schema ? (result.output ?? JSON.parse(result.text)) : result.text;
  if (new TextEncoder().encode(JSON.stringify(raw ?? null)).length > MAX_OUTPUT_BYTES)
    throw new Error("The result exceeded the supported size. Reduce the article context and retry.");
  const value: Record<string, unknown> = schema ? (schema.parse(raw) as Record<string, unknown>) : {};
  const { document: proposed, label, summary, ...rest } = value;
  const answer = schema ? undefined : text(result.text, 100_000);
  if (!schema && !answer) throw new Error("The agent returned an empty answer. Run it again.");
  const content = agentArtifactContent(rest);
  if (agent.proposesDocument) {
    content.document = proposedDraft(proposed as ProposedDocument | null, request.context?.document);
    if (schemaListsChanges(agent) && !content.changes?.length)
      throw new Error("The draft preview must explain its changes.");
  }
  // Only provider-returned citations may be presented as researched evidence.
  content.citations = result.citations.flatMap((citation) => {
    try {
      return [{ url: publicReference(citation.url), title: citation.title.slice(0, 300) }];
    } catch {
      return [];
    }
  });
  return {
    label: text(label, 160) ?? agent.name,
    artifact: {
      schemaVersion: 1,
      agentId: agent.id,
      agentVersion: agent.version,
      summary: answer ?? text(summary, 2000) ?? `Result from ${agent.name}.`,
      content,
      inputArtifactIds,
      ...(request.context?.document
        ? { baseDocumentFingerprint: agentDocumentFingerprint(request.context.document) }
        : {}),
    },
  };
}
