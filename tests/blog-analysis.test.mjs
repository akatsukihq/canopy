import { expect, test, vi } from "vitest";
import { createBlogDocument, validateBlogDocument } from "../lib/blog/document.ts";
import { validateRunRequest } from "../lib/blog/assistantValidation.ts";

vi.mock("server-only", () => ({}));

import { validateAgentOutput, AUDIT_CATEGORIES } from "../lib/blog/agentRegistry.ts";
import { BLOG_AGENTS } from "../lib/blog/agentCatalog.ts";
const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const document = {
  ...createBlogDocument("Working title"),
  body: { type: "doc", content: [paragraph("The original article.")] },
  authorName: "Actual author",
  category: { id: "category", label: "Category" },
  tags: [{ id: "tag", label: "Tag" }],
  relatedToolIds: ["devtools.json"],
};
const request = (agentId, overrides = {}) => ({
  clientRequestId: "analysis",
  operation: "agent",
  agentId,
  message: "Analyze the article",
  resourceId: "post",
  threadId: "thread",
  context: { document },
  ...overrides,
});
const result = (output) => ({
  id: "response",
  provider: "openai",
  model: "fixture",
  status: "completed",
  text: "",
  output,
  toolCalls: [],
  citations: [],
  metadata: {},
});
const base = () => ({
  label: "Result",
  summary: "Useful result.",
  sections: [],
  document: null,
  keywords: [],
  searchIntent: "",
  changes: [],
  remainingTasks: [],
});
const audit = () => ({
  ...base(),
  sections: AUDIT_CATEGORIES.map((heading) => ({
    heading,
    text: "Reviewed this category.",
    items: [],
    findings:
      heading === "Depth and completeness"
        ? [
            {
              severity: "medium",
              passage: "The original article.",
              issue: "The example needs detail.",
              recommendation: "Add one concrete example.",
            },
          ]
        : [],
  })),
});
const optimization = (body = document.body) => ({
  ...base(),
  keywords: [
    { keyword: "article", kind: "primary", rationale: "Matches topic" },
    { keyword: "guide", kind: "secondary", rationale: "Supports intent" },
    { keyword: "how to write an article", kind: "long-tail", rationale: "Specific intent" },
  ],
  searchIntent: "Learn about the topic",
  changes: ["Improved introduction"],
  remainingTasks: ["Verify the example"],
  document: {
    title: "Improved article",
    excerpt: "A useful guide.",
    seoTitle: "Useful article guide",
    seoDescription: "A useful guide to the topic.",
    bodyJson: JSON.stringify(body),
  },
});
test("all four agents share one validated operation and reject obsolete direct analysis requests", () => {
  for (const { id } of BLOG_AGENTS) {
    expect(validateRunRequest(request(id)).agentId).toBe(id);
    for (const field of ["postId", "threadId"])
      expect(() => validateRunRequest(request(id, { [field]: undefined }))).toThrow();
    expect(() => validateRunRequest(request(id, { context: { selectedText: "partial" } }))).toThrow();
    expect(() => validateRunRequest(request(id, { inputMessageId: "chat-message" }))).toThrow();
  }
  for (const operation of ["review", "optimize", "check_sources"])
    expect(() => validateRunRequest({ ...request("auditor"), operation })).toThrow();
  expect(() => validateRunRequest(request("unknown"))).toThrow();
  for (const agent of ["writer", "auditor", "optimizer"])
    expect(() => validateRunRequest(request(agent, { context: { document: undefined } }))).toThrow();
  expect(validateRunRequest(request("planner", { context: { document: undefined } })).context.document).toBe(undefined);
  expect(() => validateRunRequest(request("planner", { message: "", context: { document: undefined } }))).toThrow();
  expect(
    validateRunRequest(request("writer", { message: "", context: { document: createBlogDocument("Empty") } })).agentId,
  ).toBe("writer");
  expect(() =>
    validateRunRequest(request("auditor", { context: { document: createBlogDocument("Empty") } })),
  ).toThrow();
  expect(() =>
    validateRunRequest(request("optimizer", { context: { document: { ...document, unexpected: true } } })),
  ).toThrow();
});
test("audits cover all categories and contain no draft or ordinary chat output", () => {
  const value = validateAgentOutput(result(audit()), request("auditor"), []);
  expect(value.artifact.agentId).toBe("auditor");
  expect(value.artifact.content.sections.length).toBe(8);
  expect(value.artifact.content.document).toBe(undefined);
  expect(value.response).toBe(undefined);
  const output = audit();
  output.sections.pop();
  expect(() => validateAgentOutput(result(output), request("auditor"), [])).toThrow();
  output.sections.push(output.sections[0]);
  expect(() => validateAgentOutput(result(output), request("auditor"), [])).toThrow();
});
test("optimizer produces complete immutable generic artifact preserving administrative metadata", () => {
  const value = validateAgentOutput(result(optimization()), request("optimizer"), ["plan"]);
  expect(value.artifact.content.document.title).toBe("Improved article");
  for (const field of ["authorName", "category", "tags", "relatedToolIds", "coverImage"])
    expect(value.artifact.content.document[field]).toEqual(document[field]);
  expect(value.artifact.inputArtifactIds).toEqual(["plan"]);
  expect(value.artifact.content.html).toBe(undefined);
  expect(() => validateAgentOutput(result({ ...optimization(), keywords: [] }), request("optimizer"), [])).toThrow();
  expect(() =>
    validateAgentOutput(result(optimization({ type: "doc", content: [paragraph("")] })), request("optimizer"), []),
  ).toThrow();
});
test("draft agents normalize recoverable provider heading levels without changing heading content", () => {
  const heading = (attrs) => ({
    type: "heading",
    ...(attrs === undefined ? {} : { attrs }),
    content: [{ type: "text", text: "Useful heading", marks: [{ type: "bold" }] }],
  });
  const cases = [
    [undefined, 2],
    [{ textAlign: "center" }, 2],
    [{ level: null, textAlign: "center" }, 2],
    [{ level: 1, textAlign: "center" }, 2],
    ...Array.from({ length: 6 }, (_, index) => [
      { level: String(index + 1), textAlign: "center" },
      Math.max(2, index + 1),
    ]),
    ...Array.from({ length: 5 }, (_, index) => [{ level: index + 2, textAlign: "center" }, index + 2]),
  ];
  for (const agent of ["writer", "optimizer"]) {
    for (const [attrs, level] of cases) {
      const body = {
        type: "doc",
        content: [heading(attrs), { type: "blockquote", content: [heading(attrs), paragraph("Supporting text.")] }],
      };
      const expected = heading({ level, ...(attrs?.textAlign ? { textAlign: attrs.textAlign } : {}) });
      const value = validateAgentOutput(result(optimization(body)), request(agent), []);
      expect(value.artifact.content.document.body).toEqual({
        type: "doc",
        content: [expected, { type: "blockquote", content: [expected, paragraph("Supporting text.")] }],
      });
      expect(body.content[0]).toEqual(heading(attrs));
    }
  }
});
test("draft agents still reject malformed provider heading levels", () => {
  for (const agent of ["writer", "optimizer"]) {
    for (const level of [0, 7, -1, 2.5, "h2", "2oops", true, false, {}]) {
      const body = {
        type: "doc",
        content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: "Invalid heading" }] }],
      };
      expect(
        () => validateAgentOutput(result(optimization(body)), request(agent), []),
        `${agent} must reject heading level ${JSON.stringify(level)}`,
      ).toThrow(/Heading level/);
    }
    for (const attrs of [null, []]) {
      const body = {
        type: "doc",
        content: [{ type: "heading", attrs, content: [{ type: "text", text: "Invalid attributes" }] }],
      };
      expect(() => validateAgentOutput(result(optimization(body)), request(agent), [])).toThrow(/Node attributes/);
    }
  }
});
test("saved blog documents retain strict heading validation outside agent output", () => {
  for (const level of [1, "1", "2", "3", "4", "5", "6", null, undefined]) {
    const body = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: level === undefined ? {} : { level },
          content: [{ type: "text", text: "Invalid heading" }],
        },
      ],
    };
    expect(() => validateBlogDocument({ ...document, body })).toThrow(/Heading level/);
  }
});
test("whole-draft proposals cannot silently remove rich blocks or links", () => {
  const nodes = [
    { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const answer = 42;" }] },
    { type: "blockMath", attrs: { latex: "x^2" } },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Cell")] }] }] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Important",
          marks: [
            { type: "link", attrs: { href: "https://openai.com/", target: "_blank", rel: "noopener noreferrer" } },
          ],
        },
        { type: "inlineMath", attrs: { latex: "x" } },
      ],
    },
  ];
  const rich = validateBlogDocument({ ...document, body: { type: "doc", content: [paragraph("Intro"), ...nodes] } });
  const body = { ...rich.body, content: [paragraph("Improved intro"), ...rich.body.content.slice(1)] };
  for (const agent of ["writer", "optimizer"]) {
    expect(
      validateAgentOutput(result(optimization(body)), request(agent, { context: { document: rich } }), []).artifact
        .content.document.body,
    ).toEqual(body);
    for (let index = 1; index < rich.body.content.length; index++)
      expect(() =>
        validateAgentOutput(
          result(optimization({ ...body, content: body.content.filter((_, i) => i !== index) })),
          request(agent, { context: { document: rich } }),
          [],
        ),
      ).toThrow(/preserve/);
  }
});
test("agent images keep their stored media record and reject a mismatched URL", () => {
  const cloud = "fixture-cloud";
  const publicId = "smarttools/blog/12345678-1234-4234-8234-123456789012";
  const image = {
    media: {
      v: 1,
      provider: "cloudinary",
      format: "png",
      width: 400,
      height: 300,
      uploadedAt: "2026-01-01T00:00:00.000Z",
      entry: { cloudName: cloud, publicId, version: 1 },
    },
    alt: "Diagram",
    caption: "Original caption",
  };
  const withSource = (src) => ({
    ...document,
    coverImage: image,
    body: { type: "doc", content: [paragraph("Intro"), { type: "image", attrs: { ...image, src } }] },
  });
  const rich = withSource(`https://res.cloudinary.com/${cloud}/image/upload/v1/${publicId}.png`);
  const input = validateRunRequest(request("optimizer", { context: { document: rich } }));
  expect(
    validateAgentOutput(result(optimization(input.context.document.body)), input, []).artifact.content.document
      .coverImage,
  ).toEqual(image);
  const other = withSource(`https://res.cloudinary.com/other-cloud/image/upload/v1/${publicId}.png`);
  expect(() => validateRunRequest(request("auditor", { context: { document: other } }))).toThrow();
});

test("Planner validates complete planning sections and Writer accepts an empty draft base", () => {
  const plan = {
    ...base(),
    sections: ["Brief", "Reader intent", "Working title", "Outline", "Research gaps"].map((heading) => ({
      heading,
      text: heading === "Brief" ? "Assumption: the audience is new to the topic." : "Useful guidance",
      items: heading === "Outline" ? ["Introduction: establish the problem", "Steps: show the method"] : [],
      findings: [],
    })),
  };
  expect(
    validateAgentOutput(result(plan), request("planner", { context: { document: undefined } }), []).artifact.content
      .sections.length,
  ).toBe(5);
  expect(() =>
    validateAgentOutput(result({ ...plan, sections: plan.sections.slice(1) }), request("planner"), []),
  ).toThrow();
  const empty = createBlogDocument("Empty draft");
  expect(
    validateAgentOutput(result(optimization()), request("writer", { context: { document: empty } }), []).artifact
      .content.document.title,
  ).toBe("Improved article");
});

test("results reject invented metric fields, new internal destinations, unsafe URLs, malformed and oversized payloads", () => {
  expect(() =>
    validateAgentOutput(result({ ...optimization(), searchVolume: 5000 }), request("optimizer"), []),
  ).toThrow();
  const linked = (href) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Useful article",
            marks: [{ type: "link", attrs: { href, target: "_self", rel: "" } }],
          },
        ],
      },
    ],
  });
  expect(() =>
    validateAgentOutput(result(optimization(linked("/invented-destination"))), request("optimizer"), []),
  ).toThrow(/unverified internal link/);
  expect(() =>
    validateAgentOutput(result(optimization(linked("javascript:alert(1)"))), request("optimizer"), []),
  ).toThrow();
  expect(() => validateAgentOutput({ ...result(null), text: "not JSON" }, request("auditor"), [])).toThrow();
  expect(() =>
    validateAgentOutput(result({ ...audit(), summary: "a".repeat(2 * 1024 * 1024) }), request("auditor"), []),
  ).toThrow(/exceeded/);
  const cited = {
    ...result(audit()),
    citations: [
      { url: "https://openai.com/research", title: "Actual citation" },
      { url: "https://127.0.0.1/private", title: "Unsafe" },
    ],
  };
  expect(validateAgentOutput(cited, request("auditor"), []).artifact.content.citations).toEqual([
    { url: "https://openai.com/research", title: "Actual citation" },
  ]);
});
