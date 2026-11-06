import { z } from "zod";
import { getBlogAgent } from "./agentCatalog.ts";
import {
  validateBlogDocument,
  createBlogDocument,
  blogDocumentText,
  validateBlogImage,
  type BlogDocument,
  type BlogImage,
  type BlogNode,
} from "./document.ts";
import type { BlogAssistantRequest, BlogProposal, BlogResultData } from "./assistantTypes.ts";
import type { AssistantResult } from "../assistant/types.ts";
import type { AIResult } from "../ai/types.ts";
import {
  AssistantError,
  publicReference,
  validateRunRequest as validateAssistantRequest,
} from "../assistant/validation.ts";

export const settingsSchema = z
  .object({
    language: z.string().trim().max(80).optional(),
    tone: z.string().trim().max(120).optional(),
    length: z.string().trim().max(80).optional(),
    keyword: z.string().trim().max(200).optional(),
    audience: z.string().trim().max(300).optional(),
    webSearch: z.boolean().optional(),
    /** Generate a cover and inline images with the media agent (provider must support image generation). */
    images: z.boolean().optional(),
  })
  .strict();
const contextSchema = z
  .object({
    selectedText: z.string().min(1).max(12000).optional(),
    editorJson: z
      .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
      .passthrough()
      .optional(),
    document: z.unknown().optional(),
  })
  .strict();

export function validateRunRequest(input: unknown, reserved = false): BlogAssistantRequest {
  const request = validateAssistantRequest(input);
  const operation = z.enum(["generate", "chat", "rewrite", "agent"]).parse(request.operation);
  const parsed = { ...request, operation, settings: request.settings && settingsSchema.parse(request.settings) };
  const context = contextSchema.parse(request.context ?? {});
  if (parsed.operation === "agent") {
    const agent = getBlogAgent(parsed.agentId);
    if (!agent) throw new AssistantError("VALIDATION", "Choose an available agent.");
    if (!parsed.resourceId || !parsed.threadId)
      throw new AssistantError("VALIDATION", "Choose an article and private thread first.");
    if (context.selectedText || context.editorJson || parsed.inputMessageId)
      throw new AssistantError("VALIDATION", "Agent requests use the current document and attached sources.");
    const document = context.document === undefined ? undefined : validateBlogDocument(context.document);
    if (agent.requiresDocument && !document)
      throw new AssistantError("VALIDATION", "Attach the current blog to this agent.");
    if (["auditor", "optimizer"].includes(agent.id) && (!document || !blogDocumentText(document).trim()))
      throw new AssistantError("VALIDATION", "Write some article content before running this agent.");
    if (agent.id === "planner" && !parsed.message && (!document || !blogDocumentText(document).trim()))
      throw new AssistantError("VALIDATION", "Describe the topic you want to plan.");
    return {
      ...parsed,
      agentId: agent.id,
      message: parsed.message || `Run ${agent.name} on the current blog.`,
      context: { document },
      attachmentIds: [...new Set(parsed.attachmentIds ?? [])],
    } as BlogAssistantRequest;
  }
  if (parsed.agentId || context.document !== undefined || !parsed.message)
    throw new AssistantError("VALIDATION", "Check the request context and instruction.");
  const references = [...new Set((parsed.references ?? []).map(publicReference))];
  const attachmentIds = [...new Set(parsed.attachmentIds ?? [])];
  if (context.editorJson && JSON.stringify(context.editorJson).length > 60000)
    throw new AssistantError("VALIDATION", "Article context exceeds 60,000 characters.");
  if (parsed.operation === "generate") {
    if (
      context.selectedText ||
      context.editorJson ||
      (parsed.resourceId && !parsed.inputMessageId && !reserved) ||
      (!parsed.threadId && attachmentIds.length)
    )
      throw new AssistantError(
        "VALIDATION",
        "New generation uses a brief; use the original message to retry an existing draft.",
      );
  } else {
    if (!parsed.resourceId) throw new AssistantError("VALIDATION", "Choose an article first.");
    if (parsed.operation === "rewrite") {
      if (!context.selectedText) throw new AssistantError("VALIDATION", "Select the text to improve first.");
      if (context.editorJson || attachmentIds.length || references.length)
        throw new AssistantError("VALIDATION", "Inline rewriting uses only the selected text and instruction.");
    } else {
      if (!parsed.threadId) throw new AssistantError("VALIDATION", "Choose a private thread first.");
      if (!context.editorJson && !parsed.inputMessageId)
        throw new AssistantError("VALIDATION", "Send the editor body JSON as context.");
    }
  }
  if (parsed.inputMessageId && (!parsed.resourceId || !parsed.threadId))
    throw new AssistantError("VALIDATION", "Retry requires the original post and thread.");
  return {
    ...parsed,
    context: { ...context, document: undefined, editorJson: context.editorJson as BlogNode | undefined },
    references,
    attachmentIds,
  };
}

const blockSchema = z
  .object({
    type: z.enum(["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock"]),
    level: z.union([z.literal(2), z.literal(3)]).nullable(),
    text: z.string().max(60000),
    items: z.array(z.string().max(12000)).max(100),
  })
  .strict();
const blocks = z.array(blockSchema).min(1).max(300);
export const editToolSchema = z.object({ originalText: z.string().min(1).max(12000), blocks }).strict();
export const sectionEditToolSchema = z
  .object({
    action: z.enum(["insert", "replace", "delete"]),
    title: z.string().trim().min(1).max(160),
    placement: z.string().trim().min(1).max(200),
    originalText: z.string().max(12000),
    blocks: z.array(blockSchema).max(300),
  })
  .strict();
export const imageToolSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    placement: z.string().trim().min(1).max(200),
    originalText: z.string().max(12000),
    prompt: z.string().trim().min(1).max(2000),
    alt: z.string().trim().min(1).max(200),
    caption: z.string().max(300),
  })
  .strict();
export const seoToolSchema = z.object({ seoTitle: z.string().max(160), seoDescription: z.string().max(320) }).strict();
export const generationSchema = z
  .object({
    title: z.string().min(1).max(200),
    excerpt: z.string().max(500),
    blocks,
    seoTitle: z.string().max(160),
    seoDescription: z.string().max(320),
    keywords: z.array(z.string().max(100)).max(20),
  })
  .strict();
export function outputSchema(operation: BlogAssistantRequest["operation"]) {
  return operation === "generate" ? generationSchema : operation === "rewrite" ? editToolSchema : undefined;
}
export function blocksToNodes(input: z.infer<typeof blocks>): BlogNode[] {
  const paragraph = (text: string): BlogNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
  return input.map((block) => {
    if (block.type === "bulletList" || block.type === "orderedList")
      return {
        type: block.type,
        content: block.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
      };
    if (block.type === "blockquote") return { type: "blockquote", content: [paragraph(block.text)] };
    if (block.type === "heading")
      return { type: "heading", attrs: { level: block.level ?? 2 }, content: paragraph(block.text).content };
    return { ...paragraph(block.text), type: block.type };
  });
}
export function separateSeoProposals(proposal: BlogProposal): BlogProposal[] {
  if (proposal.data.type !== "seo") return [proposal];
  return [
    ...(proposal.data.seoTitle !== undefined
      ? [{ ...proposal, id: proposal.id + ":title", data: { ...proposal.data, seoDescription: undefined } }]
      : []),
    ...(proposal.data.seoDescription !== undefined
      ? [{ ...proposal, id: proposal.id + ":description", data: { ...proposal.data, seoTitle: undefined } }]
      : []),
  ];
}
export function validatedProposal(
  id: string,
  name: string,
  input: unknown,
  request: BlogAssistantRequest,
  prior: BlogProposal[] = [],
): BlogProposal {
  if (name === "proposeSeo") return { id, status: "pending", data: { type: "seo", ...seoToolSchema.parse(input) } };
  if (name !== "proposeEdit")
    throw new AssistantError("INVALID_OUTPUT", "The assistant requested an unsupported tool.", 422);
  const section = request.operation === "rewrite" ? undefined : sectionEditToolSchema.parse(input);
  const value = section ?? editToolSchema.parse(input);
  const action = section?.action ?? "replace";
  if (request.context?.selectedText && value.originalText !== request.context?.selectedText)
    throw new AssistantError("INVALID_OUTPUT", "The suggestion did not match the selected text. Try again.", 422);
  if (request.operation !== "rewrite") {
    const body = request.context?.editorJson;
    if (!body)
      throw new AssistantError("INVALID_OUTPUT", "The suggestion has no article context. Send a new request.", 422);
    const empty = (body.content ?? []).every(
      (node) =>
        node?.type === "paragraph" &&
        (node.content ?? []).every((child) => child?.type === "text" && !child.text?.trim()),
    );
    const passages: string[] = [];
    const visit = (node: BlogNode) => {
      if (!node || !Array.isArray(node.content ?? []))
        throw new AssistantError("INVALID_OUTPUT", "The article context is malformed. Send a new request.", 422);
      if (["paragraph", "heading", "codeBlock"].includes(node.type))
        passages.push((node.content ?? []).map((child) => (child?.type === "text" ? (child.text ?? "") : "")).join(""));
      else for (const child of node.content ?? []) visit(child);
    };
    visit(body);
    const text = passages.join("\n");
    const start = text.indexOf(value.originalText);
    if (
      value.originalText ? start < 0 || text.indexOf(value.originalText, start + 1) >= 0 : action !== "insert" || !empty
    )
      throw new AssistantError(
        "INVALID_OUTPUT",
        "The suggestion must identify one exact passage in the article. Try again.",
        422,
      );
    if (
      action === "insert" &&
      value.originalText === "" &&
      prior.some(
        (proposal) =>
          proposal.data.type === "edit" && proposal.data.action === "insert" && proposal.data.originalText === "",
      )
    )
      throw new AssistantError(
        "INVALID_OUTPUT",
        "An empty article can receive only one insertion proposal. Include all new sections in that proposal.",
        422,
      );
  }
  let replacement: BlogNode[] | undefined;
  if (action === "delete") {
    if (value.blocks.length)
      throw new AssistantError("INVALID_OUTPUT", "A section deletion cannot include replacement content.", 422);
  } else {
    replacement = blocksToNodes(value.blocks);
    const document = validateBlogDocument({
      ...createBlogDocument("Suggestion"),
      body: { type: "doc", content: replacement },
    });
    if (!blogDocumentText(document))
      throw new AssistantError("INVALID_OUTPUT", "The suggestion must contain replacement content. Try again.", 422);
  }
  return {
    id,
    status: "pending",
    ...(section ? { title: section.title } : {}),
    data: {
      type: "edit",
      action,
      ...(section ? { placement: section.placement } : {}),
      originalText: value.originalText,
      ...(replacement ? { replacement } : {}),
    },
  };
}
/** Generated images attached by the media agent; anything malformed is dropped rather than failing the draft. */
function generatedMedia(input: unknown): Array<{ placement: "cover" | "section"; heading: string; image: BlogImage }> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    try {
      const { placement, heading, image } = entry as Record<string, unknown>;
      if ((placement !== "cover" && placement !== "section") || typeof heading !== "string") return [];
      return [{ placement, heading, image: validateBlogImage(image) }];
    } catch {
      return [];
    }
  });
}
export function validateAssistantResult(
  result: AIResult,
  request: BlogAssistantRequest,
  prior: BlogProposal[] = [],
): { response: AssistantResult & { data: BlogResultData }; document?: BlogDocument } {
  const response: AssistantResult & { data: BlogResultData } = {
    text: "",
    citations: [],
    proposals: [],
    data: { keywords: [], searchStatus: "not_requested" },
  };
  response.proposals = prior;
  response.citations = result.citations.flatMap((c) => {
    try {
      return [{ url: publicReference(c.url), title: c.title.slice(0, 300) || c.url }];
    } catch {
      return [];
    }
  });
  response.data.searchStatus = request.settings?.webSearch
    ? result.searchStatus === "completed"
      ? "completed"
      : "failed"
    : "not_requested";
  if (request.operation === "chat") {
    if (!result.text.trim() && !prior.length)
      throw new AssistantError("INVALID_OUTPUT", "The assistant returned an empty response. Try again.", 422);
    response.text = result.text;
    return { response };
  }
  let value = result.output;
  if (value === null || value === undefined) {
    try {
      value = result.text ? JSON.parse(result.text) : null;
    } catch {
      throw new AssistantError("INVALID_OUTPUT", "The assistant returned incomplete structured output.", 422);
    }
  }
  if (request.operation === "generate") {
    // The media agent's server step appends stored images; they are not model output.
    const { media, mediaRequested, ...rest } =
      value && typeof value === "object" ? (value as Record<string, unknown>) : ({} as Record<string, unknown>);
    const article = generationSchema.parse(value && typeof value === "object" ? rest : value);
    const generated = generatedMedia(media);
    const nodes = blocksToNodes(article.blocks);
    // Insert from the end so earlier indexes stay valid; each image goes right after its H2.
    for (const item of generated.filter((entry) => entry.placement === "section").reverse()) {
      const index = article.blocks.findIndex(
        (block) => block.type === "heading" && (block.level ?? 2) === 2 && block.text === item.heading,
      );
      if (index >= 0)
        nodes.splice(index + 1, 0, { type: "image", attrs: { ...item.image, displayWidth: 100, alignment: "center" } });
    }
    const cover = generated.find((entry) => entry.placement === "cover");
    const document = validateBlogDocument({
      ...createBlogDocument(article.title),
      excerpt: article.excerpt,
      body: { type: "doc", content: nodes },
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      ...(cover ? { coverImage: cover.image } : {}),
    });
    if (!blogDocumentText(document))
      throw new AssistantError("INVALID_OUTPUT", "Generated article was empty. Try again.", 422);
    const requested = typeof mediaRequested === "number" ? mediaRequested : 0;
    response.text =
      "Draft generated. Review the article before publishing." +
      (requested
        ? generated.length === requested
          ? ` ${generated.length} AI-generated image${generated.length === 1 ? "" : "s"} added; review them too.`
          : ` ${generated.length} of ${requested} planned images were generated; add the rest in the editor if needed.`
        : "");
    response.data.keywords = article.keywords;
    return { response, document };
  }
  if (request.operation === "rewrite") {
    response.proposals.push(validatedProposal("rewrite", "proposeEdit", value, request));
    response.text = "Review the suggested replacement before applying it.";
  }
  return { response };
}
