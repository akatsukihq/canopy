import { z } from "zod";
import { safeLink } from "../content/links.ts";
import type { BlogNode, BlogDocument } from "./document.ts";

export type BlogArtifactContent = {
  sections?: Array<{
    heading: string;
    text?: string;
    items?: string[];
    findings?: Array<{ severity: "high" | "medium" | "low"; passage: string; issue: string; recommendation: string }>;
  }>;
  document?: BlogDocument;
  keywords?: Array<{ keyword: string; kind: "primary" | "secondary" | "long-tail"; rationale: string }>;
  searchIntent?: string;
  changes?: string[];
  remainingTasks?: string[];
  citations?: Array<{ url: string; title: string }>;
  /** Output fields without a dedicated view (custom agent schemas), shown as labelled values. */
  fields?: Record<string, unknown>;
};
export type BlogArtifact = {
  schemaVersion: 1;
  /** The configured agent's id and the version that produced this result. */
  agentId: string;
  agentVersion: number;
  summary: string;
  content: BlogArtifactContent;
  inputArtifactIds: string[];
  baseDocumentFingerprint?: string;
};
export type BlogArtifactReference = {
  attachmentId: string;
  label: string;
  agentId: string;
  summary: string;
  baseDocumentFingerprint?: string;
};
const editable = (document: BlogDocument) => ({
  title: document.title,
  excerpt: document.excerpt,
  body: document.body,
  seoTitle: document.seoTitle ?? null,
  seoDescription: document.seoDescription ?? null,
});
/** Compare editor JSON and server-normalized JSON by the same meaningful defaults. This
 * is not input validation; the server still validates the entire document separately. */
function comparisonNode(node: BlogNode): unknown {
  const attrs: Record<string, unknown> = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(([, value]) => value != null),
  );
  if (["paragraph", "heading"].includes(node.type) && attrs.textAlign === "left") delete attrs.textAlign;
  if (node.type === "orderedList" && attrs.start === 1) delete attrs.start;
  if (node.type === "codeBlock" && typeof attrs.language === "string") {
    attrs.language = attrs.language.trim();
    if (!attrs.language) delete attrs.language;
  }
  if (["tableCell", "tableHeader"].includes(node.type)) {
    if (attrs.colspan === 1) delete attrs.colspan;
    if (attrs.rowspan === 1) delete attrs.rowspan;
    if (typeof attrs.backgroundColor === "string") attrs.backgroundColor = attrs.backgroundColor.toLowerCase();
  }
  if (node.type === "image") {
    delete attrs.src;
    if (attrs.displayWidth === 100) delete attrs.displayWidth;
    if (attrs.alignment === "center") delete attrs.alignment;
    for (const key of ["alt", "caption"]) if (typeof attrs[key] === "string") attrs[key] = attrs[key].trim();
  }
  const marks = (node.marks ?? [])
    .map((mark) => {
      if (mark.type === "link") {
        const target = mark.attrs.target === "_self" ? "_self" : "_blank";
        return {
          type: "link",
          attrs: {
            href: safeLink(mark.attrs.href),
            target,
            nofollow: (mark.attrs.rel ?? "").split(/\s+/).includes("nofollow"),
          },
        };
      }
      if (mark.type === "highlight" && mark.attrs?.color)
        return { type: "highlight", attrs: { color: mark.attrs.color.toLowerCase() } };
      return { type: mark.type };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
  const leaf = ["text", "image", "inlineMath", "blockMath", "hardBreak", "horizontalRule"].includes(node.type);
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(marks.length ? { marks } : {}),
    ...(!leaf ? { content: (node.content ?? []).map(comparisonNode) } : {}),
  };
}
const comparable = (document: BlogDocument) => ({
  title: document.title.trim(),
  excerpt: document.excerpt.trim(),
  body: comparisonNode(document.body),
  seoTitle: document.seoTitle?.trim() || null,
  seoDescription: document.seoDescription?.trim() || null,
});

export function serializeAgentValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeAgentValue).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => JSON.stringify(key) + ":" + serializeAgentValue(val))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** A stable freshness token, not an authorization or cryptographic integrity check. */
export function agentDocumentFingerprint(document: BlogDocument): string {
  const value = serializeAgentValue(comparable(document));
  const states = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < value.length; i++)
    for (let n = 0; n < states.length; n++) states[n] = Math.imul(states[n] ^ (value.charCodeAt(i) + n), 0x01000193);
  return states.map((state) => (state >>> 0).toString(16).padStart(8, "0")).join("");
}
export function sameAgentDocument(a: BlogDocument | undefined, b: BlogDocument | undefined): boolean {
  return !!a && !!b && serializeAgentValue(comparable(a)) === serializeAgentValue(comparable(b));
}
const artifactContent = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string(),
            text: z.string().optional(),
            items: z.array(z.string()).optional(),
            findings: z
              .array(
                z
                  .object({
                    severity: z.enum(["high", "medium", "low"]),
                    passage: z.string(),
                    issue: z.string(),
                    recommendation: z.string(),
                  })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
      )
      .optional(),
    document: z
      .object({
        schemaVersion: z.literal(1),
        title: z.string(),
        excerpt: z.string(),
        seoTitle: z.string().nullable(),
        seoDescription: z.string().nullable(),
        body: z.object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() }).strict(),
        coverImage: z.unknown(),
        authorName: z.string(),
        category: z.unknown(),
        tags: z.array(z.unknown()),
        relatedToolIds: z.array(z.string()),
      })
      .strict()
      .optional(),
    keywords: z
      .array(
        z
          .object({ keyword: z.string(), kind: z.enum(["primary", "secondary", "long-tail"]), rationale: z.string() })
          .strict(),
      )
      .optional(),
    searchIntent: z.string().optional(),
    changes: z.array(z.string()).optional(),
    remainingTasks: z.array(z.string()).optional(),
    citations: z.array(z.object({ url: z.string(), title: z.string() }).strict()).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const KNOWN_FIELDS = ["sections", "keywords", "searchIntent", "changes", "remainingTasks"] as const;

/** Splits structured output into fields with a dedicated view and everything else (kept as `fields`). */
export function agentArtifactContent(output: Record<string, unknown>): BlogArtifactContent {
  const content: BlogArtifactContent = {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    const known = (KNOWN_FIELDS as readonly string[]).includes(key)
      ? artifactContent.safeParse({ [key]: value })
      : undefined;
    if (known?.success) Object.assign(content, known.data);
    else if (value !== undefined) fields[key] = value;
  }
  return Object.keys(fields).length ? { ...content, fields } : content;
}
const artifactEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    agentId: z.string(),
    agentVersion: z.number().int().positive(),
    summary: z.string(),
    content: artifactContent,
    inputArtifactIds: z.array(z.string()),
    baseDocumentFingerprint: z.string().optional(),
  })
  .strict();
export function supportedArtifact(value: unknown): value is BlogArtifact {
  return artifactEnvelope.safeParse(value).success;
}

export function agentReplacement(artifact: BlogArtifact, current: BlogDocument): BlogDocument {
  if (!supportedArtifact(artifact) || !artifact.content.document)
    throw new Error("This result has no supported draft to apply.");
  if (!artifact.baseDocumentFingerprint || agentDocumentFingerprint(current) !== artifact.baseDocumentFingerprint)
    throw new Error("The draft changed since this result was created. Run the agent again against the current draft.");
  return { ...current, ...editable(artifact.content.document) };
}
