import type { JSONContent } from "@tiptap/core";
import { safeLink } from "../content/links.ts";

const BLOCKS = new Set(["paragraph", "bulletList", "orderedList"]);
const INLINE = new Set(["text", "hardBreak", "agentMention", "fieldMention"]);
const MARKS = new Set(["bold", "italic", "strike", "code", "link"]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A bounded, browser-safe subset of TipTap JSON for an unsent composer draft. */
export function parseComposerContent(input: unknown): JSONContent | undefined {
  try {
    const serialized = JSON.stringify(input);
    if (!serialized || new TextEncoder().encode(serialized).byteLength > 64000) return undefined;
    let nodes = 0;
    let textLength = 0;
    let agents = 0;
    function valid(node: unknown, depth: number, parent?: string): boolean {
      if (!object(node) || typeof node.type !== "string" || depth > 12 || ++nodes > 2000) return false;
      const type = node.type;
      if (parent === undefined ? type !== "doc" : type === "doc") return false;
      if (!["doc", "listItem", ...BLOCKS, ...INLINE].includes(type)) return false;
      if (parent === "doc" && !BLOCKS.has(type)) return false;
      if (parent === "paragraph" && !INLINE.has(type)) return false;
      if ((parent === "bulletList" || parent === "orderedList") && type !== "listItem") return false;
      if (parent === "listItem" && !BLOCKS.has(type)) return false;
      if (Object.keys(node).some((key) => !["type", "attrs", "content", "text", "marks"].includes(key))) return false;
      if (type === "text") {
        if (typeof node.text !== "string" || !node.text.length) return false;
        textLength += node.text.length;
        if (textLength > 8000) return false;
      } else if (node.text !== undefined) return false;

      const attrs = node.attrs;
      if (attrs !== undefined && !object(attrs)) return false;
      if (type === "agentMention") {
        if (++agents > 1 || !attrs || typeof attrs.agentId !== "string" || attrs.agentId.length > 100) return false;
        if (Object.keys(attrs).some((key) => key !== "agentId")) return false;
      } else if (type === "fieldMention") {
        if (!attrs || Object.keys(attrs).some((key) => key !== "id" && key !== "label")) return false;
        if (typeof attrs.id !== "string" || !/^[\w.-]{1,500}$/.test(attrs.id)) return false;
        if (typeof attrs.label !== "string" || !attrs.label || attrs.label.length > 500) return false;
      } else if (type === "orderedList") {
        if (attrs && Object.keys(attrs).some((key) => key !== "start" && key !== "type")) return false;
        if (attrs?.start !== undefined && (!Number.isSafeInteger(attrs.start) || Number(attrs.start) < 1)) return false;
        if (attrs?.type !== undefined && attrs.type !== null && !["1", "a", "A", "i", "I"].includes(String(attrs.type)))
          return false;
      } else if (attrs && Object.keys(attrs).length) return false;

      if (node.marks !== undefined) {
        if (!INLINE.has(type) || !Array.isArray(node.marks) || node.marks.length > 5) return false;
        for (const mark of node.marks) {
          if (!object(mark) || typeof mark.type !== "string" || !MARKS.has(mark.type)) return false;
          if (Object.keys(mark).some((key) => key !== "type" && key !== "attrs")) return false;
          if (mark.type === "link") {
            if (!object(mark.attrs) || typeof mark.attrs.href !== "string") return false;
            safeLink(mark.attrs.href);
            if (Object.keys(mark.attrs).some((key) => !["href", "target", "rel", "class", "title"].includes(key)))
              return false;
            if (
              mark.attrs.target !== undefined &&
              mark.attrs.target !== null &&
              !["_self", "_blank"].includes(String(mark.attrs.target))
            )
              return false;
            if (
              mark.attrs.rel !== undefined &&
              mark.attrs.rel !== null &&
              (typeof mark.attrs.rel !== "string" || mark.attrs.rel.length > 100)
            )
              return false;
            if (mark.attrs.class !== undefined && mark.attrs.class !== null) return false;
            if (mark.attrs.title !== undefined && mark.attrs.title !== null) return false;
          } else if (mark.attrs !== undefined && (!object(mark.attrs) || Object.keys(mark.attrs).length)) return false;
        }
      }

      if (node.content !== undefined && !Array.isArray(node.content)) return false;
      const children = (node.content ?? []) as unknown[];
      if (INLINE.has(type) && children.length) return false;
      if (type === "listItem" && (!children.length || !object(children[0]) || children[0].type !== "paragraph"))
        return false;
      if ((type === "bulletList" || type === "orderedList") && !children.length) return false;
      return children.every((child) => valid(child, depth + 1, type));
    }
    return valid(input, 0) ? (input as JSONContent) : undefined;
  } catch {
    return undefined;
  }
}
