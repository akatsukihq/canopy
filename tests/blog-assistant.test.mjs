import { expect, test } from "vitest";
import { createBlogDocument } from "../lib/blog/document.ts";
import {
  validateRunRequest,
  validateAssistantResult,
  validatedProposal,
  separateSeoProposals,
  blocksToNodes,
} from "../lib/blog/assistantValidation.ts";

import {
  publicReference,
  validateAssistantImage,
  threadPatchSchema,
  parseStoredRequest,
  parseStoredResult,
  parseMessageParts,
  validateRunRequest as validateSharedRequest,
} from "../lib/assistant/validation.ts";

test("composer state accepts bounded inline agent positions and optional selections", () => {
  const selection = { agentId: "writer", attachmentIds: ["plan"] };
  expect(threadPatchSchema.parse({ composerState: selection }).composerState).toEqual(selection);
  for (const agentOffset of [0, 7, 8000]) {
    const composerState = { ...selection, agentOffset };
    expect(threadPatchSchema.parse({ composerState }).composerState).toEqual(composerState);
  }
  for (const agentOffset of [-1, 0.5, 8001, "7", null]) {
    expect(threadPatchSchema.safeParse({ composerState: { ...selection, agentOffset } }).success).toBe(false);
  }
});

test("thread patches validate and preserve rich composer content", () => {
  const content = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Draft", marks: [{ type: "bold" }] }] }],
  };
  const composerState = { attachmentIds: [], content };
  expect(threadPatchSchema.parse({ composerState }).composerState).toEqual(composerState);
  const unsafe = structuredClone(content);
  unsafe.content[0].content[0].marks = [{ type: "link", attrs: { href: "javascript:alert(1)" } }];
  expect(threadPatchSchema.safeParse({ composerState: { ...composerState, content: unsafe } }).success).toBe(false);
  expect(threadPatchSchema.safeParse({ composerState: { ...composerState, content: "not a document" } }).success).toBe(
    false,
  );
});

const document = {
  ...createBlogDocument("Article"),
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original text" }] }] },
};
const request = {
  clientRequestId: "request",
  operation: "rewrite",
  message: "Improve",
  resourceId: "post",
  threadId: "thread",
  context: { selectedText: "Original text" },
};
const block = { type: "paragraph", level: null, text: "Improved text", items: [] };
const result = (output, overrides = {}) => ({
  id: "response",
  provider: "openai",
  model: "fixture",
  status: "completed",
  text: "",
  output,
  toolCalls: [],
  citations: [],
  metadata: {},
  ...overrides,
});

test("inline requests send selected text without an article wrapper or coordinates", () => {
  const inline = { ...request, threadId: undefined };
  expect(validateRunRequest(inline).context.selectedText).toBe("Original text");
  expect(() => validateRunRequest({ ...inline, resourceId: undefined })).toThrow();
  expect(() => validateRunRequest({ ...inline, context: {} })).toThrow();
  expect(() => validateRunRequest({ ...inline, document, version: 1 })).toThrow();
  expect(() => validateRunRequest({ ...inline, message: "x".repeat(8001) })).toThrow();
  expect(() => validateRunRequest({ ...inline, attachmentIds: ["private-image"] })).toThrow();
});
test("chat accepts bounded editor JSON without validating full document publishing rules", () => {
  const chat = {
    clientRequestId: "chat",
    operation: "chat",
    message: "Help",
    resourceId: "post",
    threadId: "thread",
    context: { editorJson: document.body },
  };
  expect(validateRunRequest(chat).context.editorJson).toEqual(document.body);
  expect(() => validateRunRequest({ ...chat, threadId: undefined })).toThrow();
  expect(() => validateRunRequest({ ...chat, context: { ...chat.context, editorJson: [] } })).toThrow();
  expect(() =>
    validateRunRequest({
      ...chat,
      context: { ...chat.context, editorJson: { type: "doc", content: [], extra: "x".repeat(1000000) } },
    }),
  ).toThrow();
});
test("chat returns literal prose and JSON examples without an output envelope", () => {
  const text = 'Here is an example: {"text":"literal"}\nKeep this line.';
  const chat = { ...request, operation: "chat" };
  expect(validateAssistantResult(result(null, { text }), chat).response.text).toBe(text);
  expect(() => validateAssistantResult(result(null), chat)).toThrow(/empty/i);
});
test("new generation accepts a client draft thread ID without an existing article", () => {
  const input = {
    clientRequestId: "new-generation",
    operation: "generate",
    message: "A useful article",
    threadId: "draft-thread",
  };
  expect(validateRunRequest(input).threadId).toBe("draft-thread");
  expect(() => validateRunRequest({ ...input, resourceId: "existing-article" })).toThrow();
});
test("reference URLs reject credentials, local destinations and encoded private addresses", () => {
  for (const url of [
    "http://openai.com",
    "https://localhost",
    "https://a.local",
    "https://user:pass@openai.com",
    "https://127.1",
    "https://0x7f000001",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://openai.com:8443",
    "file:///tmp/file",
  ]) {
    expect(() => publicReference(url)).toThrow(/HTTPS/);
  }
  expect(publicReference("https://openai.com/docs")).toBe("https://openai.com/docs");
});
test("private images require matching signatures and bounded nonempty data", () => {
  expect(() => validateAssistantImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png")).not.toThrow();
  expect(() => validateAssistantImage(new Uint8Array([255, 216, 255, 0]), "image/jpeg")).not.toThrow();
  expect(() => validateAssistantImage(new TextEncoder().encode("RIFFxxxxWEBP"), "image/webp")).not.toThrow();
  for (const [bytes, type] of [
    [new Uint8Array(), "image/png"],
    [new Uint8Array([255, 216, 255]), "image/png"],
    [new Uint8Array(5242881), "image/png"],
    [new TextEncoder().encode("<svg/>"), "image/svg+xml"],
  ])
    expect(() => validateAssistantImage(bytes, type)).toThrow();
});
test("rewrite proposals are validated and do not mutate the working article", () => {
  const before = structuredClone(document);
  const output = validateAssistantResult(result({ originalText: "Original text", blocks: [block] }), request).response;
  expect(output.proposals[0].status).toBe("pending");
  expect(output.proposals[0].data.replacement[0].content[0].text).toBe("Improved text");
  expect(document).toEqual(before);
  expect(() =>
    validatedProposal("bad", "proposeEdit", { originalText: "Other text", blocks: [block] }, request),
  ).toThrow(/selected/);
  expect(() => validatedProposal("bad", "publish", {}, request)).toThrow(/unsupported/);
  expect(() => validateAssistantResult(result(null, { text: '{"broken"' }), request)).toThrow(/incomplete/);
});
const chatRequest = {
  ...request,
  operation: "chat",
  context: { ...request.context, selectedText: undefined, editorJson: document.body },
};
const sectionEdit = {
  action: "replace",
  title: "Clarify the introduction",
  placement: "In the introduction",
  originalText: "Original text",
  blocks: [block],
};
test("section proposals preserve their operation and review context without changing the article", () => {
  const before = structuredClone(document);
  for (const action of ["insert", "replace", "delete"]) {
    const proposal = validatedProposal(
      action,
      "proposeEdit",
      { ...sectionEdit, action, blocks: action === "delete" ? [] : [block] },
      chatRequest,
    );
    expect(proposal.data.type).toBe("edit");
    expect(proposal.status).toBe("pending");
    expect(proposal.data.action).toBe(action);
    expect(proposal.title).toBe(sectionEdit.title);
    expect(proposal.data.placement).toBe(sectionEdit.placement);
    expect(proposal.data.originalText).toBe("Original text");
    if (action === "delete") expect(proposal.data.replacement).toBe(undefined);
    else expect(proposal.data.replacement[0].content[0].text).toBe("Improved text");
  }
  expect(document).toEqual(before);
});
test("chat rejects obsolete replacement shape while inline rewrite has an explicit replace action", () => {
  const input = { originalText: "Original text", blocks: [block] };
  expect(() => validatedProposal("old", "proposeEdit", input, chatRequest)).toThrow();
  const proposal = validatedProposal("inline", "proposeEdit", input, request);
  expect(proposal.data.action).toBe("replace");
  expect(proposal.data.replacement[0].content[0].text).toBe("Improved text");
  expect(() => validatedProposal("inline", "proposeEdit", sectionEdit, request)).toThrow();
});
test("section operations reject incomplete metadata and incompatible replacement content", () => {
  for (const input of [
    { ...sectionEdit, action: "move" },
    { ...sectionEdit, action: undefined },
    { ...sectionEdit, title: " " },
    { ...sectionEdit, placement: undefined },
    { ...sectionEdit, placement: " " },
    { ...sectionEdit, action: "delete" },
    { ...sectionEdit, blocks: [] },
    { ...sectionEdit, action: "insert", blocks: [] },
    { ...sectionEdit, blocks: [{ ...block, text: " " }] },
    { ...sectionEdit, blocks: [{ ...block, type: "bulletList", text: "Unused", items: [" "] }] },
    { ...sectionEdit, blocks: [{ ...block, type: "paragraph", text: "", items: ["Unused"] }] },
  ]) {
    expect(() => validatedProposal("bad", "proposeEdit", input, chatRequest)).toThrow();
  }
  expect(() =>
    validatedProposal(
      "empty-inline",
      "proposeEdit",
      { originalText: "Original text", blocks: [{ ...block, text: " " }] },
      request,
    ),
  ).toThrow();
});
test("section proposals require one exact anchor from the supplied editor body", () => {
  const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
  for (const [context, originalText] of [
    [chatRequest, "Missing passage"],
    [chatRequest, ""],
    [{ ...chatRequest, context: { ...chatRequest.context, editorJson: undefined } }, "Original text"],
    [
      {
        ...chatRequest,
        context: {
          ...chatRequest.context,
          editorJson: { type: "doc", content: [paragraph("Original text"), paragraph("Original text")] },
        },
      },
      "Original text",
    ],
    [
      { ...chatRequest, context: { ...chatRequest.context, editorJson: { type: "doc", content: [paragraph("aaa")] } } },
      "aa",
    ],
  ]) {
    for (const action of ["insert", "replace", "delete"]) {
      expect(() =>
        validatedProposal(
          "anchor",
          "proposeEdit",
          { ...sectionEdit, originalText, action, blocks: action === "delete" ? [] : [block] },
          context,
        ),
      ).toThrow();
    }
  }
  const body = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Original", marks: [{ type: "bold" }] },
          { type: "text", text: " text" },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("List item")] }] },
    ],
  };
  const originalText = "Section\nOriginal text\nList item";
  expect(
    validatedProposal(
      "formatted",
      "proposeEdit",
      { ...sectionEdit, originalText },
      { ...chatRequest, context: { ...chatRequest.context, editorJson: body } },
    ).data.originalText,
  ).toBe(originalText);
});
test("empty insertion anchors are allowed only for genuinely empty drafts", () => {
  const input = { ...sectionEdit, action: "insert", originalText: "" };
  for (const editorJson of [
    { type: "doc" },
    { type: "doc", content: [] },
    { type: "doc", content: [{ type: "paragraph" }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " " }] }] },
  ]) {
    expect(
      validatedProposal("empty", "proposeEdit", input, {
        ...chatRequest,
        context: { ...chatRequest.context, editorJson },
      }).data.action,
    ).toBe("insert");
  }
  for (const editorJson of [
    undefined,
    document.body,
    { type: "doc", content: [{ type: "image", attrs: { alt: "" } }] },
    { type: "doc", content: [{ type: "horizontalRule" }] },
    { type: "doc", content: [{ type: "blockMath", attrs: { latex: "x" } }] },
  ]) {
    expect(() =>
      validatedProposal("nonempty", "proposeEdit", input, {
        ...chatRequest,
        context: { ...chatRequest.context, editorJson },
      }),
    ).toThrow();
  }
});
test("an empty draft receives one combined insertion proposal, never competing insertions", () => {
  const context = { ...chatRequest, context: { ...chatRequest.context, editorJson: { type: "doc", content: [] } } };
  const input = {
    ...sectionEdit,
    action: "insert",
    originalText: "",
    blocks: [block, { ...block, text: "A second section" }],
  };
  const proposal = validatedProposal("first", "proposeEdit", input, context);
  expect(proposal.data.replacement.length).toBe(2);
  const prior = [proposal];
  const before = structuredClone(prior);
  let secondError;
  try {
    validatedProposal("second", "proposeEdit", input, context, prior);
  } catch (error) {
    secondError = error;
  }
  expect(secondError).toMatchObject({ code: "INVALID_OUTPUT", message: /one insertion proposal/i });
  expect(prior).toEqual(before);
  expect(() =>
    validatedProposal("seo", "proposeSeo", { seoTitle: "Title", seoDescription: "Description" }, context, prior),
  ).not.toThrow();
  const anchoredInput = { ...sectionEdit, action: "insert" };
  const anchoredProposal = validatedProposal("anchored-first", "proposeEdit", anchoredInput, chatRequest);
  expect(() =>
    validatedProposal("anchored-second", "proposeEdit", anchoredInput, chatRequest, [anchoredProposal]),
  ).not.toThrow();
  let missingBodyError;
  try {
    validatedProposal("missing-body", "proposeEdit", input, {
      ...context,
      context: { ...context.context, editorJson: undefined },
    });
  } catch (error) {
    missingBodyError = error;
  }
  expect(missingBodyError).toMatchObject({ code: "INVALID_OUTPUT", message: /article context/i });
});
test("all section operations reject a quote that differs from the explicit selection", () => {
  for (const action of ["insert", "replace", "delete"]) {
    expect(() =>
      validatedProposal(
        "selection",
        "proposeEdit",
        { ...sectionEdit, action, blocks: action === "delete" ? [] : [block] },
        { ...chatRequest, context: { ...chatRequest.context, selectedText: "Different selection" } },
      ),
    ).toThrow(/selected/);
  }
});
test("SEO fields have separate proposal identities in the shared proposal contract", () => {
  const proposal = validatedProposal(
    "seo",
    "proposeSeo",
    { seoTitle: "Better title", seoDescription: "Better description" },
    chatRequest,
  );
  const proposals = separateSeoProposals(proposal);
  expect(proposals.map((p) => p.id)).toEqual(["seo:title", "seo:description"]);
  expect(proposals[0].data.seoDescription).toBe(undefined);
  expect(proposals[1].data.seoTitle).toBe(undefined);
  expect(separateSeoProposals({ id: "edit", data: { type: "edit" }, status: "pending" }).length).toBe(1);
});
test("generated blocks become constrained editor JSON without HTML or invented assets", () => {
  const output = {
    title: "A useful article",
    excerpt: "Useful summary",
    blocks: [
      block,
      { type: "heading", level: 3, text: "Section", items: [] },
      { type: "bulletList", level: null, text: "", items: ["Item"] },
    ],
    seoTitle: "Title",
    seoDescription: "Description",
    keywords: ["useful"],
  };
  const validated = validateAssistantResult(result(output), {
    clientRequestId: "generate",
    operation: "generate",
    message: "Write",
  });
  expect(validated.document.schemaVersion).toBe(1);
  expect(validated.document.coverImage).toBe(null);
  expect(validated.document.category).toBe(null);
  expect(validated.document.tags).toEqual([]);
  expect(blocksToNodes(output.blocks)[2].content[0].type).toBe("listItem");
});

test("chat exposes actual web execution status and filters unsafe citations", () => {
  for (const searchStatus of [undefined, "not_requested", "failed", "completed"]) {
    const response = validateAssistantResult(
      result(null, {
        text: "Answer",
        searchStatus,
        citations: [
          { url: "https://openai.com/", title: "Source" },
          { url: "javascript:alert(1)", title: "Unsafe" },
        ],
      }),
      { ...chatRequest, settings: { webSearch: true } },
    ).response;
    expect(response.data.searchStatus).toBe(searchStatus === "completed" ? "completed" : "failed");
    expect(response.citations).toEqual([{ url: "https://openai.com/", title: "Source" }]);
  }
});

test("old Blog request fields and old persisted payloads are rejected without translation", () => {
  expect(() => validateRunRequest({ ...request, postId: "post" })).toThrow();
  for (const operation of ["review", "optimize", "check_sources"]) {
    expect(() => validateRunRequest({ ...request, operation })).toThrow();
  }
  expect(() => parseStoredRequest({ ...request, schemaVersion: undefined })).toThrow();
  expect(() => parseStoredRequest({ ...request, schemaVersion: 1, postId: "post" })).toThrow();
  const proposal = { toolCallId: "old", type: "edit", status: "pending" };
  expect(() => parseStoredResult({ text: "Old", citations: [], proposals: [proposal] })).toThrow();
  expect(() => parseStoredResult({ text: "Old", citations: [], proposals: [], keywords: [] })).toThrow();
  expect(() => parseMessageParts([{ type: "proposal", proposal }])).toThrow();
  expect(parseStoredRequest({ ...request, schemaVersion: 1 })).toEqual({ ...request, schemaVersion: 1 });
});

test("combined references and attachments are bounded before resource creation", () => {
  const input = {
    clientRequestId: "bounded",
    operation: "generate",
    message: "Write",
    attachmentIds: ["one", "two", "three"],
    references: ["https://openai.com/a", "https://openai.com/b"],
  };
  expect(validateSharedRequest(input).attachmentIds.length).toBe(3);
  expect(() => validateSharedRequest({ ...input, references: [...input.references, "https://openai.com/c"] })).toThrow(
    expect.objectContaining({
      code: "VALIDATION",
    }),
  );
  expect(
    validateSharedRequest({ ...input, references: [...input.references, input.references[0]] }).references.length,
  ).toBe(2);
});

test("run requests accept a picked model and a supported effort only", () => {
  const base = { clientRequestId: "request-1", operation: "chat", message: "Hi" };
  expect(validateSharedRequest({ ...base, model: "claude-opus-5-5", effort: "high" })).toMatchObject({
    model: "claude-opus-5-5",
    effort: "high",
  });
  expect(() => validateSharedRequest({ ...base, effort: "extreme" })).toThrow();
  expect(() => validateSharedRequest({ ...base, model: "" })).toThrow();
});
