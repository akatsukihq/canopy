import { afterAll, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => {
  const shared = { failure: undefined, run: async () => ({ render: "text", text: "ok" }), captured: [] };
  globalThis.__toolApiErrorsTest = shared;
  return shared;
});

vi.mock("@sentry/core", () => ({
  captureException: (error) => state.captured.push(error),
}));
vi.mock("@/lib/tool-framework/catalog", () => ({
  getPublicToolListings: async () => {
    throw state.failure;
  },
  // The route reads the spec from the database; only the test tool has a row.
  loadSpecByDefinitionKey: async (key) =>
    key === "test-error-tool" ? { toolId: `devtools.${key}`, app: "devtools", settings: { fields: {} } } : null,
}));
vi.mock("@/lib/tool-framework/categories", () => ({ TOOL_CATEGORIES: {} }));
vi.mock("@/lib/tool-framework/icons", () => ({ resolveIcon: () => null }));
vi.mock("@/lib/tool-framework/manifest", () => ({ getToolManifest: async () => [] }));
vi.mock("@/lib/admin/index.ts", () => ({ getAvailableTools: async () => [] }));
vi.mock("@/tools/test-error-tool/run.server", () => ({ run: (...args) => state.run(...args) }));
vi.mock("@/tools/test-module-error/run.server", () => {
  throw new Error("Tool module dependency unavailable");
});
vi.mock("@/tools/test-module-empty/run.server", () => {
  throw new Error("");
});

const { GET: search } = await import("@/app/api/tools/search/route.ts");
const { GET: ecosystem } = await import("@/app/api/tools/ecosystem/route.ts");
const { POST } = await import("@/app/api/tools/[key]/route.ts");
const { ToolError } = await import("@/lib/tool-framework/run.ts");

afterAll(() => {
  delete globalThis.__toolApiErrorsTest;
});
beforeEach(() => {
  state.captured = [];
});

const post = (
  request = new Request("https://app.test/api/tools/test-error-tool", { method: "POST", body: "{}" }),
  key = "test-error-tool",
) => POST(request, { params: Promise.resolve({ key }) });

test("server execution exposes validated error coordinates and message arguments", async () => {
  state.run = async () => {
    throw new ToolError("json-syntax", "Parser detail", "Check syntax.", {
      line: 2,
      column: 3,
      values: { line: 2, column: 3 },
    });
  };
  const response = await post();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "json-syntax",
      message: "Parser detail",
      recovery: "Check syntax.",
      details: { line: 2, column: 3, values: { line: 2, column: 3 } },
    },
  });
});

for (const [name, call, fallback] of [
  ["search", () => search(new Request("https://app.test/api/tools/search?q=test")), "Unable to search tools"],
  ["ecosystem", ecosystem, "Unable to load tool categories"],
]) {
  test(`${name} returns the caught message without stack and falls back for empty errors`, async () => {
    for (const failure of [
      new Error("Catalog connection timed out"),
      { message: "Catalog connection timed out", stack: "private stack" },
      null,
      new Error(""),
    ]) {
      state.failure = failure;
      const response = await call();
      expect(state.captured.at(-1)).toBe(failure);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: failure?.message || fallback });
    }
  });
}

test("tool execution keeps codes and statuses while returning original messages or its fallback", async () => {
  for (const failure of [
    new Error("Upstream quota exceeded"),
    { message: "Upstream quota exceeded", stack: "private stack" },
    undefined,
    new Error(""),
  ]) {
    state.run = async () => {
      throw failure;
    };
    const response = await post();
    expect(state.captured.at(-1)).toBe(failure);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "processing-failed",
        message: failure?.message || "This tool could not finish. The input may be malformed or unsupported.",
      },
    });
  }
  state.run = async () => {
    throw new ToolError("unsupported-input", "Image is too large", "Choose a smaller image.");
  };
  const response = await post();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "unsupported-input", message: "Image is too large", recovery: "Choose a smaller image." },
  });
  const invalid = await post(undefined, "../private");
  expect(invalid.status).toBe(404);
  expect(await invalid.json()).toEqual({ error: { code: "unknown-tool", message: "This tool is not available." } });
  expect(state.captured.length, "expected tool errors are not reported").toBe(4);
});

test("JSON read failures preserve invalid-request status and error messages with a fallback", async () => {
  for (const failure of [new Error("Unexpected end of JSON input"), undefined]) {
    const request = new Request("https://app.test/api/tools/test-error-tool", { method: "POST", body: "{}" });
    request.json = async () => {
      throw failure;
    };
    const response = await post(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid-request", message: failure?.message || "Request body must be JSON." },
    });
  }
  expect(state.captured).toEqual([]);
});

test("module loading failures report unknown-tool without capturing the error", async () => {
  // Message forwarding is covered by the search/ecosystem/execution cases above,
  // which throw normal errors. A vi.mock factory throw has its message relocated
  // to error.cause by vitest, so only the classification is asserted here.
  for (const key of ["test-module-error", "test-module-empty"]) {
    const response = await post(undefined, key);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("unknown-tool");
  }
  expect(state.captured).toEqual([]);
});
