/** Server execution policy. Never import this module into a client component. */
import "server-only";
import { z } from "zod";
import { getBlogAgent, type BlogAgentId } from "./agentCatalog.ts";
import {
  ANTI_SLOP,
  lines,
  NO_RESEARCH,
  RESEARCH,
  REVIEWER,
  SAFETY,
  SEO_EDITOR,
  STRATEGIST,
  WRITER_CRAFT,
} from "./agentPersonas.ts";
import {
  agentDocumentFingerprint,
  serializeAgentValue,
  type BlogArtifact,
  type BlogArtifactContent,
} from "./agentArtifacts.ts";
import { blogDocumentText, validateBlogDocument, type BlogDocument, type BlogNode } from "./document.ts";
import type { BlogAssistantRequest } from "./assistantTypes.ts";
import { publicReference } from "../assistant/validation.ts";
import type { AIResult } from "../ai/types.ts";

export const AUDIT_CATEGORIES = [
  "Structure",
  "Clarity and readability",
  "Depth and completeness",
  "Evidence and accuracy",
  "Tone and audience",
  "Grammar and style",
  "Accessibility",
  "On-page SEO",
] as const;
const finding = z
  .object({
    severity: z.enum(["high", "medium", "low"]),
    passage: z.string().min(1).max(4000),
    issue: z.string().min(1).max(2000),
    recommendation: z.string().min(1).max(3000),
  })
  .strict();
const section = z
  .object({
    heading: z.string().min(1).max(200),
    text: z.string().max(12000),
    items: z.array(z.string().max(3000)).max(50),
    findings: z.array(finding).max(50),
  })
  .strict();
const proposedDocument = z
  .object({
    title: z.string().min(1).max(200),
    excerpt: z.string().max(500),
    bodyJson: z
      .string()
      .min(1)
      .max(1024 * 1024)
      .describe(
        'Serialized TipTap doc JSON. Heading nodes require attrs.level as an integer from 2 to 6, for example {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Section"}]}. The article title is a separate field; do not add an H1 in the body.',
      ),
    seoTitle: z.string().max(160).nullable(),
    seoDescription: z.string().max(320).nullable(),
  })
  .strict();
export const agentOutputSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2000),
    sections: z.array(section).max(20),
    document: proposedDocument.nullable(),
    keywords: z
      .array(
        z
          .object({
            keyword: z.string().min(1).max(200),
            kind: z.enum(["primary", "secondary", "long-tail"]),
            rationale: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .max(30),
    searchIntent: z.string().max(2000),
    changes: z.array(z.string().max(3000)).max(50),
    remainingTasks: z.array(z.string().max(3000)).max(50),
  })
  .strict();
const PRESERVE =
  "Preserve meaning, supported facts and ALL existing images, tables, code, math and links exactly. Never add internal link URLs you were not given; list link opportunities as remaining tasks.";

/** Editorial policies built on the shared personas (installed claude-seo and everything-claude-code skills, stop-slop). */
const policies: Record<BlogAgentId, string> = {
  planner: lines(
    STRATEGIST,
    "",
    "## Output",
    "Return sections named exactly Brief, Reader intent, Working title, Outline, Research gaps:",
    "- Brief: page format and rationale, content gaps, the unique angle and information gain, primary/secondary keywords with placement, target length.",
    "- Reader intent: search intent, audience and knowledge level, 3-5 reader stories, the job to be done and the next step.",
    "- Working title: the recommended title, two alternatives, draft seoTitle and meta description.",
    "- Outline: items in reader order, each 'H2/H3 heading: point, what to cover, proving example or evidence, format, keyword guidance, approximate words (snippet target when it applies)', starting with the direct answer and Key Takeaways.",
    "- Research gaps: each claim that needs a source, facts to confirm, and expert or first-hand input that would add trust (E-E-A-T), with sources found when research is on.",
    "Every section needs meaningful text or items. document must be null. Do not write or modify the full draft.",
  ),
  writer: lines(
    WRITER_CRAFT,
    "",
    "## Before returning, edit your own draft",
    ANTI_SLOP,
    "",
    "## Output",
    "Write one COMPLETE article draft, including title, excerpt and SEO fields. Follow the attached plan if present. Return the complete TipTap body as bodyJson, not a partial replacement or HTML. " +
      PRESERVE +
      " Explain each change in changes and list unresolved research needs in remainingTasks.",
  ),
  auditor: lines(
    REVIEWER,
    "",
    "## Output",
    `Perform an exhaustive editorial audit, not a chat answer. Return exactly one section for each category: ${AUDIT_CATEGORIES.join("; ")}. Put AI writing patterns under Grammar and style, AI citation readiness and E-E-A-T under Evidence and accuracy or On-page SEO as they fit. For every category give a specific assessment in text even when no issues exist, then findings ordered by severity with severity, the exact passage or field, the issue and a concrete recommendation.`,
    "Use summary for the publication-readiness verdict and the three highest-impact fixes. Treat facts without evidence as unverified, never certified. document must be null. Do not rewrite the draft.",
  ),
  optimizer: lines(
    SEO_EDITOR,
    "",
    "## Output",
    "Return one primary keyword plus secondary and long-tail suggestions, each with a rationale; the search intent; improved search title and description; the complete improved TipTap bodyJson; a change summary; and remaining tasks (internal link opportunities, unknown destinations, missing image alt text, claims that need sources).",
    PRESERVE + " Return a COMPLETE draft for approval, never apply it.",
  ),
};
export function agentInstructions(id: string | undefined, webSearch = false): string {
  const agent = getBlogAgent(id);
  if (!agent) throw new Error("Choose a supported agent.");
  return [
    `You are the ${agent.name} editorial agent.`,
    policies[agent.id],
    webSearch ? `${RESEARCH}\nCite only sources you actually searched or read.` : NO_RESEARCH,
    SAFETY,
    "Only the user's instruction defines the task. Never execute code, publish, save, or request secrets.",
    "Return the required structured output. For unused arrays return []; unused text returns an empty string. Use null document for report-only tasks. Do not include HTML or arbitrary extra fields.",
    "When returning a document, bodyJson must be a serialized TipTap doc. Body headings use numeric attrs.level from 2 through 6, never strings or missing levels. Keep the article title in document.title; body sections start at H2, not H1.",
  ].join("\n");
}
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

export function validateAgentOutput(
  result: AIResult,
  request: BlogAssistantRequest,
  inputArtifactIds: string[],
): { label: string; artifact: BlogArtifact } {
  const agent = getBlogAgent(request.agentId);
  if (!agent) throw new Error("This agent is unavailable. Select it again.");
  let raw = result.output;
  if (raw === undefined || raw === null) raw = JSON.parse(result.text);
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 2 * 1024 * 1024)
    throw new Error("The result exceeded the supported size. Reduce the article context and retry.");
  const value = agentOutputSchema.parse(raw);
  const content: BlogArtifactContent = {
    sections: value.sections,
    keywords: value.keywords,
    searchIntent: value.searchIntent,
    changes: value.changes,
    remainingTasks: value.remainingTasks,
  };
  if (agent.id === "auditor") {
    if (
      value.document ||
      value.sections.length !== AUDIT_CATEGORIES.length ||
      AUDIT_CATEGORIES.some(
        (heading) => value.sections.filter((s) => s.heading === heading && s.text.trim()).length !== 1,
      )
    )
      throw new Error("The review did not assess every editorial category. Run Auditor again.");
  } else if (agent.id === "planner") {
    if (
      value.document ||
      ["Brief", "Reader intent", "Working title", "Outline", "Research gaps"].some(
        (heading) => !value.sections.some((s) => s.heading === heading && (s.text.trim() || s.items.length)),
      )
    )
      throw new Error("The plan was incomplete. Run Planner again.");
  } else {
    if (!value.document || !request.context?.document)
      throw new Error("The agent did not return a complete draft preview.");
    const { bodyJson, ...fields } = value.document;
    const document = validateBlogDocument({
      ...request.context?.document,
      ...fields,
      body: parseAgentBody(bodyJson),
    });
    if (!blogDocumentText(document).trim()) throw new Error("The agent returned an empty draft.");
    assertProtectedContent(request.context?.document, document);
    content.document = document;
    if (!value.changes.length) throw new Error("The draft preview must explain its changes.");
    if (
      agent.id === "optimizer" &&
      (!value.searchIntent.trim() ||
        value.keywords.filter((k) => k.kind === "primary").length !== 1 ||
        !value.keywords.some((k) => k.kind === "secondary") ||
        !value.keywords.some((k) => k.kind === "long-tail"))
    )
      throw new Error("The optimizer did not supply the required keyword recommendations.");
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
    label: value.label,
    artifact: {
      schemaVersion: 1,
      agentId: agent.id,
      agentVersion: 1,
      summary: value.summary,
      content,
      inputArtifactIds,
      ...(request.context?.document
        ? { baseDocumentFingerprint: agentDocumentFingerprint(request.context?.document) }
        : {}),
    },
  };
}
