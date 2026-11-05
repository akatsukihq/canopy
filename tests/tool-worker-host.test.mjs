import { afterAll, expect, test, vi } from "vitest";
import { createToolRunFile } from "../lib/tool-framework/workerProtocol.ts";

const state = { listener: null, receive: null };
const originalAddEventListener = globalThis.addEventListener;
const originalPostMessage = globalThis.postMessage;
globalThis.addEventListener = (_type, listener) => {
  state.listener = listener;
};
globalThis.postMessage = (message) => {
  state.receive?.(message);
};

vi.mock("@/lib/tool-framework/artifacts.ts", () => ({
  ArtifactStorageError: class ArtifactStorageError extends Error {},
  cleanupArtifactJobWithRetry: async () => {},
  createArtifactWriter: () => ({ write: async () => {} }),
}));

// One worker that throws while running, one whose module fails to load: both
// are tool failures, not a missing worker.
vi.mock("@/tools/test-broken-worker/run.worker", () => ({
  default: async () => {
    throw new Error("private failure detail");
  },
}));
vi.mock("@/tools/test-broken-module/run.worker", () => {
  throw new Error("private dependency failure");
});

await import("@/lib/tool-framework/tool.worker.ts");

afterAll(() => {
  if (originalAddEventListener) globalThis.addEventListener = originalAddEventListener;
  else delete globalThis.addEventListener;
  if (originalPostMessage) globalThis.postMessage = originalPostMessage;
  else delete globalThis.postMessage;
});

// The page sends the spec it loaded from the database; only the fields these
// workers read are declared here.
const toggle = (value) => ({ kind: "toggle", label: "x", default: value });
const INPUTS = {
  "markdown-previewer": {
    kind: "text",
    label: "Markdown document",
    acceptFiles: {
      accept: ".md,.markdown,.txt,text/markdown,text/plain",
      maxBytes: 2_000_000,
      maxEditableBytes: 2_000_000,
    },
  },
};
const SETTINGS = {
  "markdown-previewer": {
    syntaxHighlighting: toggle(true),
    safeLinks: toggle(true),
    previewMode: { kind: "select", label: "x", default: "gfm", choices: [{ value: "gfm", label: "GFM" }] },
  },
};
const specFor = (key) => ({
  toolId: `devtools.${key}`,
  app: "devtools",
  input: INPUTS[key] ?? { kind: "text", label: "Input" },
  settings: { fields: SETTINGS[key] ?? {} },
});

function dispatch(key, input = {}) {
  return new Promise((resolve) => {
    state.receive = resolve;
    state.listener({
      data: {
        type: "run",
        jobId: key,
        key,
        files: [],
        settings: {},
        spec: specFor(key),
        text: "https://example.com",
        ...input,
      },
    });
  });
}

test("a missing worker implementation reports unknown-tool so the caller can use the server host", async () => {
  const response = await dispatch("test-server-tool");
  expect(response.type).toBe("failure");
  expect(response.code).toBe("unknown-tool");
});

test("worker execution and dependency failures remain processing failures", async () => {
  for (const key of ["test-broken-worker", "test-broken-module"]) {
    const response = await dispatch(key);
    expect(response.type).toBe("failure");
    expect(response.code).toBe("processing-failed");
    expect(response.message.includes("private")).toBe(false);
  }
});

test("JSON worker failures carry numeric locations independently of English messages", async () => {
  const response = await dispatch("json-viewer", { text: '{\n  "missing":\n}' });
  expect(response.type).toBe("failure");
  expect(response.code).toBe("json-syntax");
  expect(response.details).toMatchObject({ line: expect.any(Number), column: expect.any(Number) });
  expect(response.details.values).toEqual({ line: response.details.line, column: response.details.column });
});

function workerFile(file) {
  return createToolRunFile(file.name, file);
}

test("the actual Markdown worker accepts a large uploaded .md file without a MIME type", async () => {
  const paragraph = "Every uploaded paragraph must remain in the complete preview.\n\n";
  const count = Math.floor(1_940_000 / paragraph.length);
  const source = paragraph.repeat(count) + "# Last section\n\nFinal uploaded content.";
  const file = new File([source], "large-document.md");
  expect(file.size > 1_900_000 && file.size < 2_000_000).toBeTruthy();
  const response = await dispatch("markdown-previewer", { files: [workerFile(file)], text: await file.text() });
  expect(response.type, JSON.stringify(response)).toBe("success");
  expect(response.result.render).toBe("html");
  expect(response.result.deferCodeHighlighting).toBe(true);
  expect(response.result.html).toMatch(/<h1>Last section<\/h1>/);
  expect(response.result.html).toMatch(/Final uploaded content\./);
  expect((response.result.html.match(/Every uploaded paragraph must remain/g) ?? []).length).toBe(count);
}, 5000);

test("the actual Markdown worker still accepts text without an uploaded file", async () => {
  const response = await dispatch("markdown-previewer", { text: "# Typed Markdown\n\n**Complete text**" });
  expect(response.type, JSON.stringify(response)).toBe("success");
  expect(response.result.render).toBe("html");
  expect(response.result.html).toMatch(/<h1>Typed Markdown<\/h1>/);
  expect(response.result.html).toMatch(/<strong>Complete text<\/strong>/);
});

test("Markdown uploads accept declared text extensions and MIME types", async () => {
  for (const [name, type] of [
    ["README.MD", ""],
    ["readme.markdown", ""],
    ["notes.txt", "text/plain"],
    ["readme", "text/markdown"],
  ]) {
    const source = "# Uploaded document\n\nAll content is retained.";
    const file = new File([source], name, { type });
    const response = await dispatch("markdown-previewer", { files: [workerFile(file)], text: await file.text() });
    expect(response.type, JSON.stringify(response)).toBe("success");
    expect(response.result.html).toMatch(/<h1>Uploaded document<\/h1>/);
    expect(response.result.html).toMatch(/All content is retained\./);
  }
});

test("Markdown uploads accept the 2,000,000-byte limit without truncating the final content", async () => {
  const ending = "\n\n# Exact limit\n\nFinal boundary content.";
  const source = "a".repeat(2_000_000 - ending.length) + ending;
  const file = new File([source], "exact-limit.md");
  expect(file.size).toBe(2_000_000);
  const response = await dispatch("markdown-previewer", { files: [workerFile(file)], text: await file.text() });
  expect(response.type, JSON.stringify(response)).toBe("success");
  expect(response.result.html).toMatch(/<h1>Exact limit<\/h1>/);
  expect(response.result.html).toMatch(/Final boundary content\./);
  expect(response.result.deferCodeHighlighting).toBe(true);
});

test("the actual Markdown worker rejects unsupported, oversized, empty and multiple uploads", async () => {
  const cases = [
    {
      label: "unsupported extension and MIME",
      files: [new File(["# Contents"], "document.png", { type: "image/png" })],
      code: "unsupported-type",
    },
    {
      label: "one byte above the upload limit",
      files: [new File(["a".repeat(2_000_001)], "too-large.md")],
      code: "file-too-large",
    },
    {
      label: "empty file",
      files: [new File([], "empty.md")],
      code: "invalid-size",
    },
    {
      label: "multiple files",
      files: [new File(["# One"], "one.md"), new File(["# Two"], "two.md")],
      code: "too-many-files",
    },
  ];
  for (const { label, files, code } of cases) {
    const response = await dispatch("markdown-previewer", { files: files.map(workerFile), text: "# Input" });
    expect(response.type, `${label}: ${JSON.stringify(response)}`).toBe("failure");
    expect(response.code, label).toBe(code);
  }
});
