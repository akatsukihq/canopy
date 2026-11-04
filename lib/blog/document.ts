import { createHash, randomBytes } from "node:crypto";
import { slugFromName } from "../tool-catalog/index.ts";
import { highlightCode } from "../markdown/codeHighlight.ts";
import { normalizeBlogMath } from "./math.ts";
import { MAX_MATH_LENGTH, renderMath } from "../markdown/math.ts";
import { BLOG_IMAGE_PUBLIC_ID, BLOG_TITLE_WORD_LIMIT, blogTitleWordCount, blogImageDelivery } from "./utils.ts";
import { safeLink as validateLink } from "../content/links.ts";
import { mediaRef, mediaUrl, type MediaRef } from "../media/index.ts";

export interface BlogImage {
  media: MediaRef;
  alt: string;
  caption: string;
}

export interface BlogTerm {
  id: string;
  label: string;
}
export type BlogMark =
  | { type: "bold" | "italic" | "strike" | "underline" | "code" | "superscript" | "subscript" }
  | { type: "link"; attrs: { href: string; target: "_blank" | "_self"; rel: string } }
  | { type: "highlight"; attrs?: { color: string } };
type NodeType =
  | "taskList"
  | "taskItem"
  | "doc"
  | "paragraph"
  | "text"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote"
  | "horizontalRule"
  | "hardBreak"
  | "table"
  | "tableRow"
  | "tableCell"
  | "tableHeader"
  | "codeBlock"
  | "inlineMath"
  | "blockMath"
  | "image";
export interface BlogNode {
  type: NodeType;
  attrs?: Record<string, string | number | number[] | boolean | null | MediaRef>;
  content?: BlogNode[];
  text?: string;
  marks?: BlogMark[];
}
export interface BlogDocument {
  schemaVersion: 1;
  title: string;
  excerpt: string;
  body: BlogNode;
  coverImage: BlogImage | null;
  authorName: string;
  category: BlogTerm | null;
  tags: BlogTerm[];
  seoTitle: string | null;
  seoDescription: string | null;
  relatedToolIds: string[];
}
export class BlogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlogValidationError";
  }
}

function fail(message: string): never {
  throw new BlogValidationError(message);
}
export function assertBlogTitleWordLimit(title: string): void {
  if (blogTitleWordCount(title) > BLOG_TITLE_WORD_LIMIT)
    fail(`Title must contain at most ${BLOG_TITLE_WORD_LIMIT} words.`);
}
function record(input: unknown, label: string): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    fail(`${label} must be a JSON object.`);
  return input as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(input))
    if (!allowed.includes(key)) fail(`${label} has an unsupported property: ${key}.`);
}
function string(input: unknown, label: string, max: number, trim = true): string {
  if (
    typeof input !== "string" ||
    !input.isWellFormed() ||
    input.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)
  )
    fail(`${label} must be text of at most ${max} characters without control characters.`);
  return trim ? input.trim() : input;
}
function integer(input: unknown, label: string, min: number, max: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min || input > max)
    fail(`${label} must be an integer from ${min} to ${max}.`);
  return input;
}
function list(input: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(input) || input.length > max) fail(`${label} must be a list of at most ${max} items.`);
  return input;
}

// Bound traversal before JSON.stringify so cyclic/deep or non-JSON inputs fail safely.
function checkJson(input: unknown) {
  const ancestors = new Set<object>();
  let count = 0;
  let characters = 0;
  function walk(value: unknown, depth: number) {
    if (++count > 100000) fail("Document is too complex.");
    if (depth > 128) fail("Document exceeds the maximum JSON depth.");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 1024 * 1024) fail("Document exceeds the 1 MiB size limit.");
    } else if (value !== null && typeof value === "object") {
      if (ancestors.has(value)) fail("Document must be JSON without cyclic references.");
      ancestors.add(value);
      if (Array.isArray(value)) {
        if (value.length > 10001) fail("Document has too many nodes.");
        if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)
          fail("Document lists must contain only JSON items.");
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !("value" in descriptor)) fail("Document lists must contain only JSON items.");
          walk(descriptor.value, depth + 1);
        }
      } else {
        const object = record(value, "Document value");
        if (Reflect.ownKeys(object).length !== Object.keys(object).length)
          fail("Document must contain only JSON properties.");
        for (const key of Object.keys(object)) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            fail("Document contains an unsafe JSON property.");
          const descriptor = Object.getOwnPropertyDescriptor(object, key);
          if (!descriptor || !("value" in descriptor)) fail("Document must contain only JSON values.");
          characters += key.length;
          walk(descriptor.value, depth + 1);
        }
      }
      ancestors.delete(value);
    } else if (value !== null && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value)))
      fail("Document must contain only JSON values.");
  }
  walk(input, 0);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 1024 * 1024)
    fail("Document exceeds the 1 MiB size limit.");
}

/** Delivery URL for an image already checked by validateBlogImage. */
export function blogImageUrl(image: BlogImage): string {
  return mediaUrl(image.media);
}
export function validateBlogImage(input: unknown): BlogImage {
  const object = record(input, "Image");
  keys(object, ["media", "alt", "caption", "src"], "Image");
  const parsed = mediaRef.safeParse(object.media);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.at(-1);
    fail(
      field === "format"
        ? "Image format must be JPEG, PNG or WebP."
        : field === "publicId"
          ? "Image public ID must identify an uploaded immutable blog asset."
          : "Image details are incomplete or invalid. Upload the image again.",
    );
  }
  const media = parsed.data;
  if (
    !BLOG_IMAGE_PUBLIC_ID.test(media.entry.publicId)
  )
    fail("Image public ID must identify an uploaded immutable blog asset.");
  const image: BlogImage = {
    media,
    alt: string(object.alt, "Image alt text", 500),
    caption: string(object.caption, "Image caption", 1000),
  };
  if (object.src !== undefined && object.src !== blogImageUrl(image))
    fail("Image URL must match its immutable uploaded asset.");
  return image;
}
export function safeLink(input: unknown): string {
  try {
    return validateLink(input);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : "Link URL is invalid.");
  }
}
function mark(input: unknown): BlogMark {
  const object = record(input, "Text mark");
  keys(object, ["type", "attrs"], "Text mark");
  if (
    !["bold", "italic", "strike", "underline", "code", "link", "highlight", "superscript", "subscript"].includes(
      object.type as string,
    )
  )
    fail("Text mark is unsupported.");
  if (object.type === "highlight") {
    const attrs = object.attrs === undefined ? {} : record(object.attrs, "Highlight attributes");
    keys(attrs, ["color"], "Highlight attributes");
    if (attrs.color == null) return { type: "highlight" };
    if (typeof attrs.color !== "string" || !/^#[0-9a-f]{6}$/i.test(attrs.color))
      fail("Highlight color must be a six-digit hexadecimal color.");
    return { type: "highlight", attrs: { color: attrs.color.toLowerCase() } };
  }
  if (object.type !== "link") {
    if (object.attrs !== undefined && Object.keys(record(object.attrs, "Mark attributes")).length)
      fail("Text mark has unsupported attributes.");
    return { type: object.type as Exclude<BlogMark["type"], "link" | "highlight"> };
  }
  const attrs = record(object.attrs, "Link attributes");
  keys(attrs, ["href", "target", "rel", "class", "title"], "Link attributes");
  // The editor adds null defaults; only the supported attributes survive normalization.
  if (
    attrs.class != null ||
    attrs.title != null ||
    (attrs.target != null && attrs.target !== "_blank" && attrs.target !== "_self")
  )
    fail("Link has unsupported attributes.");
  if (
    attrs.rel != null &&
    (typeof attrs.rel !== "string" || !/^(?:(?:noopener|noreferrer|nofollow)\s*)*$/.test(attrs.rel))
  )
    fail("Link relationship is unsupported.");
  const target = attrs.target === "_self" ? "_self" : "_blank";
  const rel =
    `${target === "_blank" ? "noopener noreferrer" : ""}${typeof attrs.rel === "string" && attrs.rel.split(/\s+/).includes("nofollow") ? " nofollow" : ""}`.trim();
  return { type: "link", attrs: { href: safeLink(attrs.href), target, rel } };
}

const BLOCKS: NodeType[] = [
  "taskList",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
  "table",
  "codeBlock",
  "blockMath",
  "image",
];
const CHILDREN: Partial<Record<NodeType, readonly NodeType[]>> = {
  doc: BLOCKS,
  paragraph: ["text", "hardBreak", "inlineMath"],
  heading: ["text", "hardBreak", "inlineMath"],
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  listItem: BLOCKS,
  taskList: ["taskItem"],
  taskItem: BLOCKS,
  blockquote: BLOCKS,
  table: ["tableRow"],
  tableRow: ["tableCell", "tableHeader"],
  tableCell: BLOCKS,
  tableHeader: BLOCKS,
  codeBlock: ["text"],
};

function validateTable(node: BlogNode) {
  const rows = node.content ?? [];
  const occupied: boolean[][] = rows.map(() => []);
  const columnWidths: number[] = [];
  for (let row = 0; row < rows.length; row++) {
    let column = 0;
    for (const cell of rows[row].content ?? []) {
      while (occupied[row][column]) column++;
      const colspan = Number(cell.attrs?.colspan ?? 1);
      const rowspan = Number(cell.attrs?.rowspan ?? 1);
      if (column + colspan > 100 || row + rowspan > rows.length) fail("Table spans exceed its dimensions.");
      const widths = cell.attrs?.colwidth as number[] | null;
      for (let offset = 0; offset < colspan; offset++) {
        // Older snapshots may only record widths on later rows or contain conflicts.
        columnWidths[column + offset] ||= widths?.[offset] ?? 0;
      }
      for (let y = row; y < row + rowspan; y++)
        for (let x = column; x < column + colspan; x++) {
          if (occupied[y][x]) fail("Table contains overlapping merged cells.");
          occupied[y][x] = true;
        }
      column += colspan;
    }
  }
  const width = occupied[0]?.length ?? 0;
  if (
    !width ||
    occupied.some(
      (row) => row.length !== width || Array.from({ length: width }, (_, x) => row[x]).some((value) => !value),
    )
  )
    fail("Table rows must form a complete rectangular grid.");
  return columnWidths;
}

function validateBody(input: unknown): BlogNode {
  let nodes = 0;
  function visit(value: unknown, depth: number): BlogNode {
    if (++nodes > 10000) fail("Document has too many nodes.");
    if (depth > 32) fail("Document exceeds the maximum node depth.");
    const object = record(value, "Editor node");
    const type = object.type as NodeType;
    if (
      ![
        "doc",
        "text",
        "inlineMath",
        "taskItem",
        "listItem",
        "hardBreak",
        "tableRow",
        "tableCell",
        "tableHeader",
        ...BLOCKS,
      ].includes(type)
    )
      fail("Editor node type is unsupported.");
    keys(
      object,
      type === "text"
        ? ["type", "text", "marks"]
        : type === "inlineMath"
          ? ["type", "attrs", "marks", "content"]
          : ["type", "attrs", "content"],
      "Editor node",
    );
    const node: BlogNode = { type };
    if (type === "text") {
      node.text = string(object.text, "Article text", 1024 * 1024, false);
      if (!node.text) fail("Text nodes must not be empty.");
      if (object.marks !== undefined) {
        const marks = list(object.marks, "Text marks", 9).map(mark);
        if (new Set(marks.map((item) => item.type)).size !== marks.length)
          fail("Duplicate text marks are unsupported.");
        if (marks.some((item) => item.type === "code") && marks.length > 1)
          fail("Inline code cannot combine with other text marks.");
        if (marks.length) node.marks = marks.sort((a, b) => a.type.localeCompare(b.type));
      }
      return node;
    }
    const attrs = object.attrs === undefined ? {} : record(object.attrs, "Node attributes");
    if (type === "heading" || type === "paragraph") {
      keys(attrs, type === "heading" ? ["level", "textAlign"] : ["textAlign"], "Text block attributes");
      if (type === "heading") node.attrs = { level: integer(attrs.level, "Heading level", 2, 6) };
      if (attrs.textAlign != null) {
        if (!["left", "center", "right", "justify"].includes(attrs.textAlign as string))
          fail("Text alignment is unsupported.");
        node.attrs = { ...node.attrs, textAlign: attrs.textAlign as string };
      }
    } else if (type === "taskItem") {
      keys(attrs, ["checked"], "Checklist attributes");
      if (typeof attrs.checked !== "boolean") fail("Checklist checked state must be a boolean.");
      node.attrs = { checked: attrs.checked };
    } else if (type === "orderedList") {
      keys(attrs, ["start", "type"], "List attributes");
      if (attrs.type != null) fail("Ordered list type is unsupported.");
      node.attrs = {
        start: attrs.start === undefined ? 1 : integer(attrs.start, "List start", 1, 1000000),
      };
    } else if (type === "inlineMath" || type === "blockMath") {
      keys(attrs, ["latex"], "Math attributes");
      const latex = string(attrs.latex, "Math source", MAX_MATH_LENGTH, false);
      if (!latex.trim()) fail("Math source must not be empty.");
      node.attrs = { latex };
      if (type === "inlineMath" && object.marks !== undefined) {
        const marks = list(object.marks, "Math marks", 9).map(mark);
        if (marks.some((item) => item.type === "code") || new Set(marks.map((item) => item.type)).size !== marks.length)
          fail("Math marks cannot contain code or duplicates.");
        if (marks.length) node.marks = marks.sort((a, b) => a.type.localeCompare(b.type));
      }
    } else if (type === "codeBlock") {
      keys(attrs, ["language"], "Code block attributes");
      const language = attrs.language == null ? null : string(attrs.language, "Code language", 40);
      if (language && !/^[a-zA-Z0-9_+-]+$/.test(language)) fail("Code language is invalid.");
      node.attrs = { language: language || null };
    } else if (type === "image") {
      const { displayWidth, alignment, ...asset } = attrs;
      if (alignment != null && !["left", "center", "right"].includes(alignment as string))
        fail("Image alignment is unsupported.");
      node.attrs = {
        ...validateBlogImage(asset),
        displayWidth: displayWidth == null ? 100 : integer(displayWidth, "Image display width", 10, 100),
        alignment: alignment == null ? "center" : (alignment as string),
      };
    } else if (type === "tableCell" || type === "tableHeader") {
      keys(attrs, ["colspan", "rowspan", "colwidth", "align", "backgroundColor"], "Table cell attributes");
      const colspan = attrs.colspan === undefined ? 1 : integer(attrs.colspan, "Column span", 1, 100);
      const rowspan = attrs.rowspan === undefined ? 1 : integer(attrs.rowspan, "Row span", 1, 1000);
      const colwidth =
        attrs.colwidth == null
          ? null
          : list(attrs.colwidth, "Column widths", colspan).map((width) => integer(width, "Column width", 0, 10000));
      if (colwidth && colwidth.length !== colspan) fail("Column widths must match the column span.");
      node.attrs = { colspan, rowspan, colwidth };
      if (attrs.align != null) {
        if (!["left", "center", "right"].includes(attrs.align as string)) fail("Table cell alignment is unsupported.");
        node.attrs.align = attrs.align as string;
      }
      if (attrs.backgroundColor != null) {
        if (typeof attrs.backgroundColor !== "string" || !/^#[0-9a-f]{6}$/i.test(attrs.backgroundColor))
          fail("Table cell background color must be a six-digit hexadecimal color.");
        node.attrs.backgroundColor = attrs.backgroundColor.toLowerCase();
      }
    } else keys(attrs, [], "Node attributes");
    const allowed = CHILDREN[type];
    if (!allowed) {
      if (object.content !== undefined) fail("Leaf editor nodes cannot contain content.");
      return node;
    }
    node.content = list(object.content ?? [], "Editor content", 10001).map((child) => visit(child, depth + 1));
    if (node.content.some((child) => !allowed.includes(child.type))) fail(`Invalid child content in ${type}.`);
    // A row may be fully occupied by cells spanning from the preceding row;
    // validateTable checks its coverage rather than rejecting it as empty here.
    if (!["doc", "paragraph", "heading", "codeBlock", "tableRow"].includes(type) && !node.content.length)
      fail(`${type} must contain content.`);
    if (["listItem", "taskItem"].includes(type) && node.content[0]?.type !== "paragraph")
      fail("List items must start with a paragraph.");
    if (type === "codeBlock" && node.content.some((child) => child.marks?.length))
      fail("Code blocks cannot contain text marks.");
    if (type === "table") validateTable(node);
    return node;
  }
  const body = visit(input, 0);
  if (body.type !== "doc") fail("Article body must be a document.");
  return body;
}

function term(input: unknown): BlogTerm {
  const object = record(input, "Taxonomy selection");
  keys(object, ["id", "label"], "Taxonomy selection");
  const id = string(object.id, "Taxonomy ID", 100);
  const label = string(object.label, "Taxonomy label", 100);
  if (!id || !label || !/^[a-zA-Z0-9_-]+$/.test(id)) fail("Taxonomy selection requires a valid ID and label.");
  return { id, label };
}

export function validateBlogDocument(input: unknown): BlogDocument {
  checkJson(input);
  const object = record(input, "Article document");
  keys(
    object,
    [
      "schemaVersion",
      "title",
      "excerpt",
      "body",
      "coverImage",
      "authorName",
      "category",
      "tags",
      "seoTitle",
      "seoDescription",
      "relatedToolIds",
    ],
    "Article document",
  );
  if (object.schemaVersion !== 1) fail("Article schema version is unsupported.");
  const tags = list(object.tags, "Tags", 20)
    .map(term)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(tags.map((tag) => tag.id)).size !== tags.length) fail("Duplicate tags are unsupported.");
  const relatedToolIds = list(object.relatedToolIds, "Related tools", 12).map((item) => {
    const id = string(item, "Related tool ID", 150);
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(id)) fail("Related tool ID is invalid.");
    return id;
  });
  if (new Set(relatedToolIds).size !== relatedToolIds.length) fail("Duplicate related tools are unsupported.");
  return {
    schemaVersion: 1,
    title: string(object.title, "Title", 200),
    excerpt: string(object.excerpt, "Excerpt", 500),
    body: validateBody(object.body),
    coverImage: object.coverImage === null ? null : validateBlogImage(object.coverImage),
    authorName: string(object.authorName, "Author name", 150),
    category: object.category === null ? null : term(object.category),
    tags,
    seoTitle: object.seoTitle === null ? null : string(object.seoTitle, "SEO title", 160) || null,
    seoDescription:
      object.seoDescription === null ? null : string(object.seoDescription, "SEO description", 320) || null,
    relatedToolIds,
  };
}

export function createBlogDocument(title: string): BlogDocument {
  const document = validateBlogDocument({
    schemaVersion: 1,
    title,
    excerpt: "",
    body: { type: "doc", content: [{ type: "paragraph" }] },
    coverImage: null,
    authorName: "SmartTools Team",
    category: null,
    tags: [],
    seoTitle: null,
    seoDescription: null,
    relatedToolIds: [],
  });
  if (!document.title) fail("Title is required.");
  assertBlogTitleWordLimit(document.title);
  return document;
}

function nodeText(node: BlogNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "inlineMath" || node.type === "blockMath") return String(node.attrs?.latex ?? "");
  if (node.type === "image") return [node.attrs?.alt, node.attrs?.caption].filter(Boolean).join(" ");
  if (node.type === "hardBreak" || node.type === "horizontalRule") return "\n";
  const text = (node.content ?? []).map(nodeText).join("");
  return ["doc", "paragraph", "heading", "codeBlock", "tableCell", "tableHeader"].includes(node.type)
    ? `${text}\n`
    : text;
}
export function blogDocumentText(document: BlogDocument): string {
  return nodeText(document.body).trim();
}

export function assertBlogPublishable(document: BlogDocument): void {
  if (!document.title.trim()) fail("Title is required for publication.");
  assertBlogTitleWordLimit(document.title);
  if (!document.excerpt.trim()) fail("Excerpt is required for publication.");
  if (!document.authorName.trim()) fail("Author name is required for publication.");
  if (!document.category) fail("A category is required for publication.");
  if (!blogDocumentText(document)) fail("Article body must contain meaningful content.");
  if (document.coverImage && !document.coverImage.alt.trim()) fail("Cover image alt text is required for publication.");
  function check(node: BlogNode) {
    if (node.type === "image" && !String(node.attrs?.alt ?? "").trim())
      fail("Inline image alt text is required for publication.");
    node.content?.forEach(check);
  }
  check(document.body);
}

export function blogSlugFromTitle(title: string): string {
  const normalized = string(title, "Title", 200);
  try {
    return slugFromName(normalized).slice(0, 160).replace(/-+$/, "");
  } catch {
    return `post-${randomBytes(4).toString("hex")}`;
  }
}

export function blogDocumentHash(document: BlogDocument): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  }
  return createHash("sha256").update(canonical(document)).digest("hex");
}

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function renderBlogDocument(input: BlogDocument): {
  html: string;
  headings: { id: string; level: number; text: string }[];
  readingMinutes: number;
} {
  // Stored JSON is also a trust boundary: never assume database content is safe HTML.
  const document = validateBlogDocument(input);
  const headings: { id: string; level: number; text: string }[] = [];
  function render(node: BlogNode): string {
    const content = () => (node.content ?? []).map(render).join("");
    const alignment = node.attrs?.textAlign ? ` style="text-align:${node.attrs.textAlign}"` : "";
    switch (node.type) {
      case "doc":
        return content();
      case "inlineMath":
      case "text": {
        const formula = node.type === "inlineMath" ? renderMath(String(node.attrs?.latex ?? ""), false) : null;
        let html = formula
          ? `<span class="blog-math-inline${formula.error ? " blog-math-error" : ""}">${formula.html}</span>`
          : escapeHtml(node.text);
        for (const textMark of node.marks ?? []) {
          if (textMark.type === "link") {
            const attrs = textMark.attrs!;
            html = `<a href="${escapeHtml(attrs.href)}" target="${attrs.target}"${attrs.rel ? ` rel="${attrs.rel}"` : ""}>${html}</a>`;
          } else if (textMark.type === "highlight" && textMark.attrs?.color) {
            html = `<mark style="background-color:${textMark.attrs.color}">${html}</mark>`;
          } else {
            const tag = {
              bold: "strong",
              italic: "em",
              strike: "s",
              underline: "u",
              code: "code",
              highlight: "mark",
              superscript: "sup",
              subscript: "sub",
            }[textMark.type];
            html = `<${tag}>${html}</${tag}>`;
          }
        }
        return html;
      }
      case "paragraph":
        return `<p${alignment}>${content()}</p>`;
      case "heading": {
        const text = nodeText(node).trim();
        const level = Number(node.attrs!.level);
        const id = `heading-${headings.length + 1}`;
        headings.push({ id, level, text });
        return `<h${level} id="${id}"${alignment}>${content()}</h${level}>`;
      }
      case "taskList":
        return `<ul data-type="taskList">${content()}</ul>`;
      case "taskItem":
        return `<li data-type="taskItem"><span data-task-checkbox="${node.attrs?.checked ? "true" : "false"}" role="checkbox" aria-readonly="true" aria-checked="${node.attrs?.checked ? "true" : "false"}" aria-label="${node.attrs?.checked ? "Completed" : "Not completed"}">${node.attrs?.checked ? "☑" : "☐"}</span><div>${content()}</div></li>`;
      case "bulletList":
        return `<ul>${content()}</ul>`;
      case "orderedList":
        return `<ol start="${node.attrs!.start}">${content()}</ol>`;
      case "listItem":
        return `<li>${content()}</li>`;
      case "blockquote":
        return `<blockquote>${content()}</blockquote>`;
      case "horizontalRule":
        return "<hr>";
      case "hardBreak":
        return "<br>";
      case "blockMath": {
        const { html, error } = renderMath(String(node.attrs?.latex ?? ""), true);
        return `<div class="blog-math-block${error ? " blog-math-error" : ""}">${html}</div>`;
      }
      case "codeBlock": {
        const code = (node.content ?? []).map((child) => child.text ?? "").join("");
        const language = node.attrs?.language as string | null;
        return `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${highlightCode(code, language)}</code></pre>`;
      }
      case "table": {
        const widths = validateTable(node);
        const resized = widths.some(Boolean);
        const totalWidth = widths.reduce((total, width) => total + (width || 25), 0);
        const sizing = resized
          ? `;table-layout:fixed;${widths.every(Boolean) ? `width:${totalWidth}px` : `width:100%;min-width:${totalWidth}px`}`
          : "";
        const columns = resized
          ? `<colgroup>${widths.map((width) => (width ? `<col style="width:${width}px">` : "<col>")).join("")}</colgroup>`
          : "";
        return `<div role="region" aria-label="Scrollable table" tabindex="0" style="max-width:100%;overflow-x:auto"><table style="display:table;max-width:none${sizing}">${columns}<tbody>${content()}</tbody></table></div>`;
      }
      case "tableRow":
        return `<tr>${content()}</tr>`;
      case "tableCell":
      case "tableHeader": {
        const tag = node.type === "tableCell" ? "td" : "th";
        const styles = [
          node.attrs!.align ? `text-align:${node.attrs!.align}` : "",
          node.attrs!.backgroundColor ? `background-color:${node.attrs!.backgroundColor}` : "",
        ]
          .filter(Boolean)
          .join(";");
        return `<${tag} colspan="${node.attrs!.colspan}" rowspan="${node.attrs!.rowspan}"${styles ? ` style="${styles}"` : ""}>${content()}</${tag}>`;
      }
      case "image": {
        const { displayWidth, alignment: imageAlignment, ...asset } = node.attrs!;
        const image = validateBlogImage(asset);
        const layout = `width:${displayWidth}%;margin-left:${imageAlignment === "left" ? "0" : "auto"};margin-right:${imageAlignment === "right" ? "0" : "auto"}`;
        const delivery = blogImageDelivery(image);
        const sizes = `auto, (min-width: 1440px) ${Math.round((1015 * Number(displayWidth)) / 100)}px, ${displayWidth}vw`;
        return `<figure style="${layout}"><img src="${escapeHtml(delivery.src)}" srcset="${escapeHtml(delivery.srcSet)}" sizes="${sizes}" alt="${escapeHtml(image.alt)}" width="${image.media.width}" height="${image.media.height}" style="width:100%;height:auto" loading="lazy" decoding="async">${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}</figure>`;
      }
    }
  }
  const html = render(normalizeBlogMath(document.body));
  return {
    html,
    headings,
    readingMinutes: Math.max(1, Math.ceil(blogDocumentText(document).split(/\s+/).filter(Boolean).length / 200)),
  };
}
