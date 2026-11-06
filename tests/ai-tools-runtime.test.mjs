import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/observability/logger.ts", () => ({ log: vi.fn(), logError: vi.fn(), errorDetails: () => ({}) }));
const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args) => lookup(...args),
  default: { lookup: (...args) => lookup(...args) },
}));
const executeCode = vi.fn();
vi.mock("../lib/code-execution/run.ts", () => ({ executeCode: (...args) => executeCode(...args) }));
const codeConfig = vi.fn();
vi.mock("../lib/code-execution/config.ts", () => ({ readCodeExecutionConfig: () => codeConfig() }));

const { runCustomTool, customAITools } = await import("../lib/agents/toolRuntime.ts");
const { htmlToText } = await import("../lib/agents/toolOutput.ts");

const fetchMock = vi.fn();
beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  executeCode.mockReset();
  codeConfig.mockReset();
  codeConfig.mockReturnValue({ url: "http://piston", token: "t", maxConcurrent: 2 });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;
const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const httpTool = (http = {}, over = {}) => ({
  id: "t1",
  key: "search",
  name: "Search",
  description: "Searches",
  kind: "http",
  argsSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  inputs: [{ id: "apiKey", label: "API key", type: "secret", required: true, defaultValue: null, description: null }],
  http: {
    method: "GET",
    url: "https://api.example.com/search",
    headers: { Authorization: "Bearer {{inputs.apiKey}}" },
    query: { q: "{{args.q}}" },
    body: null,
    responsePath: null,
    timeoutMs: 1000,
    ...http,
  },
  code: null,
  output: { parser: "auto", transform: null, schema: null },
  requiresApproval: false,
  enabled: true,
  updatedAt: "",
  updatedBy: null,
  ...over,
});
const codeTool = (over = {}) =>
  httpTool(undefined, { kind: "code", http: null, code: { language: "python", source: "print(1)" }, ...over });
const okRun = (stdout) => ({ status: "ok", stdout, stderr: "", compileOutput: "", exitCode: 0 });
const keys = { apiKey: "sk-1" };

test("HTTP success: resolves the template, sends secrets as headers and returns parsed JSON freeform", async () => {
  fetchMock.mockResolvedValue(json({ data: { items: [1, 2] } }));
  const report = await runCustomTool(httpTool(), { q: "cats" }, keys, signal());
  expect(report).toMatchObject({ ok: true, result: { data: { items: [1, 2] } }, httpStatus: 200, schema: "freeform" });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("https://api.example.com/search?q=cats");
  expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: "Bearer sk-1" } });
  expect(init.body).toBeUndefined();
});

test("POST sends the typed JSON body and responsePath picks a sub-value without a size cap", async () => {
  const big = "x".repeat(3 * 1024 * 1024);
  fetchMock.mockResolvedValue(json({ data: { items: [big] } }));
  const tool = httpTool({ method: "POST", body: { query: "{{args.q}}", limit: 3 }, responsePath: "data.items.0" });
  const report = await runCustomTool(tool, { q: "cats" }, keys, signal());
  expect(report.result).toBe(big);
  const init = fetchMock.mock.calls[0][1];
  expect(JSON.parse(init.body)).toEqual({ query: "cats", limit: 3 });
  expect(init.headers["content-type"]).toBe("application/json");
});

test("json inputs reach the body as typed objects; invalid json is an error without sending", async () => {
  fetchMock.mockResolvedValue(json({ ok: true }));
  const filters = {
    id: "filters",
    label: "Filters",
    type: "json",
    required: true,
    defaultValue: null,
    description: null,
  };
  const tool = httpTool(
    {
      method: "POST",
      body: { query: "{{args.q}}", filters: "{{inputs.filters}}", region: "{{inputs.filters.region}}" },
    },
    { inputs: [...httpTool().inputs, filters] },
  );
  await runCustomTool(tool, { q: "cats" }, { ...keys, filters: '{"region":"eu","tags":["a"]}' }, signal());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    query: "cats",
    filters: { region: "eu", tags: ["a"] },
    region: "eu",
  });
  fetchMock.mockClear();
  const bad = await runCustomTool(tool, { q: "cats" }, { ...keys, filters: "{nope" }, signal());
  expect(bad.ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("non-2xx becomes an error result for the model", async () => {
  fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
  const report = await runCustomTool(httpTool(), { q: "x" }, keys, signal());
  expect(report).toMatchObject({ ok: false, httpStatus: 404, result: { error: { status: 404, body: "nope" } } });
});

test("timeout becomes an error result", async () => {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
  );
  const report = await runCustomTool(httpTool(), { q: "x" }, keys, signal());
  expect(report.result).toEqual({ error: "The request timed out after 1 seconds." });
});

test("redirects are re-checked: a hop to a private address is blocked", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://internal.example.com/" } }),
  );
  lookup.mockImplementation(async (host) =>
    host === "internal.example.com" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }],
  );
  const report = await runCustomTool(httpTool(), { q: "x" }, keys, signal());
  expect(report.ok).toBe(false);
  expect(report.result.error).toMatch(/blocked/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a cross-origin redirect drops the headers; too many redirects fail", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example.net/r" } }))
    .mockResolvedValueOnce(json({ ok: true }));
  expect((await runCustomTool(httpTool(), { q: "x" }, keys, signal())).ok).toBe(true);
  expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
  const loop = await runCustomTool(httpTool(), { q: "x" }, keys, signal());
  expect(loop.result.error).toMatch(/redirected more than 3/);
});

test("a private origin is blocked before any request", async () => {
  lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  const report = await runCustomTool(httpTool(), { q: "x" }, keys, signal());
  expect(report.result.error).toMatch(/blocked/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("missing required inputs and invalid args return errors without sending", async () => {
  expect((await runCustomTool(httpTool(), { q: "x" }, {}, signal())).result.error).toMatch(/API key/);
  expect((await runCustomTool(httpTool(), { q: 3 }, keys, signal())).result.error).toBe("Invalid arguments");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("parsers: json, text, html-text and auto fallback", async () => {
  const run = async (parser, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const tool = httpTool(undefined, { output: { parser, transform: null, schema: null } });
    return runCustomTool(tool, { q: "x" }, keys, signal());
  };
  expect((await run("json", "not json")).result).toEqual({ error: "The response is not valid JSON." });
  expect((await run("text", '{"a":1}')).result).toBe('{"a":1}');
  expect((await run("auto", "plain words")).result).toBe("plain words");
  expect(
    (
      await run(
        "html-text",
        "<html><head><title>x</title></head><body><script>bad()</script><p>Hi &amp; bye</p><p>Two</p></body></html>",
      )
    ).result,
  ).toBe("Hi & bye\nTwo");
  expect(htmlToText("a<br>b&#65;&#x42;")).toBe("a\nbAB");
});

test("code parser runs the transform with the HTTP response on stdin", async () => {
  fetchMock.mockResolvedValue(new Response('{"n":2}', { status: 200 }));
  executeCode.mockResolvedValue(okRun('{"doubled":4}\n'));
  const tool = httpTool(undefined, {
    output: { parser: "code", transform: { language: "javascript", source: "x" }, schema: null },
  });
  const report = await runCustomTool(tool, { q: "x" }, keys, signal());
  expect(report.result).toEqual({ doubled: 4 });
  const stdin = JSON.parse(executeCode.mock.calls[0][2]);
  expect(stdin).toMatchObject({ body: '{"n":2}', status: 200 });
});

test("schema pass returns the value; schema fail returns issues", async () => {
  const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
  const tool = httpTool(undefined, { output: { parser: "json", transform: null, schema } });
  fetchMock.mockResolvedValueOnce(json({ n: 1 }));
  expect(await runCustomTool(tool, { q: "x" }, keys, signal())).toMatchObject({
    ok: true,
    result: { n: 1 },
    schema: "passed",
  });
  fetchMock.mockResolvedValueOnce(json({ n: "one" }));
  const failed = await runCustomTool(tool, { q: "x" }, keys, signal());
  expect(failed).toMatchObject({ ok: false, schema: "failed", result: { error: "Output did not match schema" } });
  expect(failed.result.issues[0].path).toBe("n");
});

test("code tools get args and inputs on stdin; failures carry stderr", async () => {
  executeCode.mockResolvedValueOnce(okRun("[1,2]"));
  const ok = await runCustomTool(codeTool(), { q: "x" }, keys, signal());
  expect(ok).toMatchObject({ ok: true, result: [1, 2], exitCode: 0 });
  expect(JSON.parse(executeCode.mock.calls[0][2])).toEqual({ args: { q: "x" }, inputs: { apiKey: "sk-1" } });
  executeCode.mockResolvedValueOnce({
    status: "runtime-error",
    stdout: "",
    stderr: "Traceback",
    compileOutput: "",
    exitCode: 1,
  });
  const bad = await runCustomTool(codeTool(), { q: "x" }, keys, signal());
  expect(bad.result).toEqual({ error: "The code exited with code 1.", stderr: "Traceback" });
});

test("code tools fail closed when execution is not configured", async () => {
  codeConfig.mockReturnValue(null);
  const report = await runCustomTool(codeTool(), { q: "x" }, keys, signal());
  expect(report.result).toEqual({ error: "Code execution is not configured." });
  expect(executeCode).not.toHaveBeenCalled();
});

test("AI tools: custom_<key>, approval flag, output schema, disabled tools left out", async () => {
  const schema = { type: "object", properties: {} };
  const tools = customAITools(
    [
      {
        tool: httpTool(undefined, { requiresApproval: true, output: { parser: "auto", transform: null, schema } }),
        inputs: keys,
      },
      { tool: httpTool(undefined, { id: "t2", key: "off", enabled: false }), inputs: keys },
    ],
    { signal: signal(), reportToolFailure: vi.fn() },
  );
  expect(Object.keys(tools)).toEqual(["custom_search"]);
  expect(tools.custom_search.needsApproval).toBe(true);
  expect(tools.custom_search.outputSchema).toBeDefined();
  fetchMock.mockResolvedValue(json({}));
  expect(await tools.custom_search.execute({ q: "x" }, { toolCallId: "c1" })).toEqual({});
});
