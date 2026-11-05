import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { agentSlashQuery, removeAgentSlash, sameComposerSelection } from "../lib/assistant/composer.ts";
import { parseComposerContent } from "../lib/assistant/composerDocument.ts";

const richContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Please ", marks: [{ type: "bold" }] },
        { type: "agentMention", attrs: { agentId: "writer" } },
        { type: "text", text: " use this ", marks: [{ type: "italic" }, { type: "strike" }] },
        { type: "hardBreak" },
        { type: "text", text: "code", marks: [{ type: "code" }] },
      ],
    },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] }],
    },
    {
      type: "orderedList",
      attrs: { start: 2, type: null },
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] }],
    },
  ],
};

test("slash actions activate only at an empty token, preserving surrounding instruction", () => {
  const text = "Please /audit this guide";
  const token = agentSlashQuery(text, 13);
  expect(token).toEqual({ start: 7, end: 13, query: "audit" });
  expect(removeAgentSlash(text, token)).toEqual({ text: "Please  this guide", caret: 7 });
  expect(agentSlashQuery("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  expect(agentSlashQuery("https://example.com/audit", 25)).toBe(null);
  expect(agentSlashQuery("/usr/local/", 11)).toBe(null);
  expect(agentSlashQuery("some/path", 9)).toBe(null);
  expect(agentSlashQuery("Please /audit now", 17)).toBe(null);
});

test("acknowledgement clears only the selection that was actually submitted", () => {
  const submitted = { agentId: "writer", attachmentIds: ["plan"] };
  expect(sameComposerSelection(submitted, { ...submitted, attachmentIds: ["plan"] })).toBe(true);
  expect(sameComposerSelection(submitted, { agentId: "auditor", attachmentIds: ["plan"] })).toBe(false);
  expect(sameComposerSelection(submitted, { agentId: "writer", attachmentIds: ["plan", "source"] })).toBe(false);
  expect(sameComposerSelection(submitted, { ...submitted, agentOffset: 0 })).toBe(true);
  expect(sameComposerSelection(submitted, { ...submitted, agentOffset: 7 })).toBe(false);
  expect(sameComposerSelection({ ...submitted, agentOffset: 7 }, { ...submitted, agentOffset: 7 })).toBe(true);
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Write" }] }] };
  expect(sameComposerSelection({ ...submitted, content }, { ...submitted, content: structuredClone(content) })).toBe(
    true,
  );
  const changed = structuredClone(content);
  changed.content[0].content[0].marks = [{ type: "bold" }];
  expect(sameComposerSelection({ ...submitted, content }, { ...submitted, content: changed })).toBe(false);
});

test("composer rich text preserves supported marks, lists, newlines and an inline agent", () => {
  expect(parseComposerContent(richContent)).toEqual(richContent);
  for (const href of ["https://example.com", "http://example.com", "mailto:editor@example.com", "/local", "#section"]) {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Source",
              marks: [
                { type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } },
              ],
            },
          ],
        },
      ],
    };
    expect(parseComposerContent(content)).toEqual(content);
  }
});

test("composer links roundtrip the installed TipTap schema default attributes", () => {
  const schema = getSchema([StarterKit]);
  const content = schema
    .nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Source", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    })
    .toJSON();
  expect(content.content[0].content[0].marks[0].attrs.title).toBe(null);
  expect(parseComposerContent(content)).toEqual(content);
  for (const title of ["Native tooltip", 42, { html: "<script>" }]) {
    const invalid = structuredClone(content);
    invalid.content[0].content[0].marks[0].attrs.title = title;
    expect(parseComposerContent(invalid)).toBe(undefined);
  }
});

test("composer content rejects unsafe links, unsupported nodes and malformed nesting", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.com",
    "https://user:password@example.com",
  ]) {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Source",
              marks: [{ type: "link", attrs: { href } }],
            },
          ],
        },
      ],
    };
    expect(parseComposerContent(content)).toBe(undefined);
  }
  for (const content of [
    { type: "doc", content: [{ type: "image", attrs: { src: "https://example.com/image.png" } }] },
    { type: "doc", content: [{ type: "text", text: "Wrong parent" }] },
    { type: "doc", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "alert(1)" } }] },
    {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Underlined", marks: [{ type: "underline" }] }] }],
    },
  ])
    expect(parseComposerContent(content)).toBe(undefined);
});

test("composer content bounds text, nodes, depth, size and inline agent count", () => {
  const textDoc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  expect(parseComposerContent(textDoc("x".repeat(8000)))).toBeTruthy();
  expect(parseComposerContent(textDoc("x".repeat(8001)))).toBe(undefined);
  expect(
    parseComposerContent({ type: "doc", content: Array.from({ length: 2000 }, () => ({ type: "paragraph" })) }),
  ).toBe(undefined);
  const duplicateAgents = structuredClone(richContent);
  duplicateAgents.content[0].content.push({ type: "agentMention", attrs: { agentId: "writer" } });
  expect(parseComposerContent(duplicateAgents)).toBe(undefined);
  const longAgent = structuredClone(richContent);
  longAgent.content[0].content[1].attrs.agentId = "x".repeat(101);
  expect(parseComposerContent(longAgent)).toBe(undefined);
  let nested = { type: "paragraph", content: [{ type: "text", text: "Nested" }] };
  for (let i = 0; i < 8; i++)
    nested = { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }, nested] }] };
  expect(parseComposerContent({ type: "doc", content: [nested] })).toBe(undefined);
  const oversized = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: Array.from({ length: 40 }, () => ({
          type: "text",
          text: "link",
          marks: [{ type: "link", attrs: { href: `https://example.com/${"x".repeat(1900)}` } }],
        })),
      },
    ],
  };
  expect(parseComposerContent(oversized)).toBe(undefined);
});

test("field mention chips keep only a safe id and a label", () => {
  const doc = (attrs) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "fieldMention", attrs }, { type: "text", text: " fix" }] }],
  });
  expect(parseComposerContent(doc({ id: "seoTitle", label: "SEO title" }))).toBeDefined();
  expect(parseComposerContent(doc({ id: "tool.name", label: "tool.name" }))).toBeDefined();
  for (const attrs of [{ id: "seo title", label: "x" }, { id: "seoTitle", label: "" }, { id: "a", label: "b", extra: 1 }])
    expect(parseComposerContent(doc(attrs))).toBeUndefined();
});
