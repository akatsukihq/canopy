import { expect, test } from "vitest";

const { substitute, resolveUrl, placeholders, TemplateError } = await import("../lib/agents/toolTemplate.ts");
const { toolInputSchema } = await import("../lib/agents/toolTypes.ts");

const scope = {
  args: { q: "a b&c", count: 5, filter: { tag: "x" }, path: "../admin" },
  inputs: { apiKey: "sk-1", baseUrl: "https://api.example.com/v2" },
};

test("an exact placeholder keeps its type; embedded ones are stringified", () => {
  expect(
    substitute({ n: "{{args.count}}", f: "{{ args.filter }}", s: "n={{args.count}} f={{args.filter}}" }, scope),
  ).toEqual({
    n: 5,
    f: { tag: "x" },
    s: 'n=5 f={"tag":"x"}',
  });
  expect(substitute(["Bearer {{inputs.apiKey}}", 3, null], scope)).toEqual(["Bearer sk-1", 3, null]);
  expect(substitute({ "{{args.q}}": "key" }, scope)).toEqual({ "{{args.q}}": "key" });
  expect(substitute("{{args.filter.tag}}", scope)).toBe("x");
});

test("only args and inputs are placeholders, and missing values throw", () => {
  expect(substitute("{{env.SECRET}} {{process}}", scope)).toBe("{{env.SECRET}} {{process}}");
  expect(() => substitute("{{args.missing}}", scope)).toThrow(TemplateError);
  expect(() => substitute("{{inputs.nope}}", scope)).toThrow(/inputs\.nope/);
  expect(placeholders({ a: ["{{args.q}}"], b: "{{inputs.apiKey}}" })).toEqual([
    { kind: "args", path: "q" },
    { kind: "inputs", path: "apiKey" },
  ]);
});

test("path placeholders are percent-encoded and query values go through URLSearchParams", () => {
  const url = resolveUrl(
    "https://api.example.com/items/{{args.path}}",
    { q: "{{args.q}}", n: "{{args.count}}" },
    scope,
  );
  expect(url.pathname).toBe("/items/..%2Fadmin");
  expect(url.searchParams.get("q")).toBe("a b&c");
  expect(url.searchParams.get("n")).toBe("5");
});

test("the origin can come from a single URL input", () => {
  expect(resolveUrl("{{inputs.baseUrl}}/search", {}, scope).href).toBe("https://api.example.com/v2/search");
  const hostile = { ...scope, args: { ...scope.args, host: "@evil.example" } };
  expect(() => resolveUrl("https://api.example.com{{args.host}}", {}, hostile)).toThrow(TemplateError);
  expect(resolveUrl("https://api.example.com/{{args.host}}", {}, hostile).origin).toBe("https://api.example.com");
});

test("args in the origin, http and origin changes are rejected", () => {
  expect(() => resolveUrl("https://{{args.host}}/x", {}, { ...scope, args: { host: "evil.example" } })).toThrow(
    /fixed host/,
  );
  expect(() => resolveUrl("{{args.url}}", {}, { ...scope, args: { url: "https://evil.example" } })).toThrow(
    /fixed host/,
  );
  expect(() => resolveUrl("http://api.example.com/x", {}, scope)).toThrow(/fixed host/);
  expect(() =>
    resolveUrl("{{inputs.baseUrl}}", {}, { ...scope, inputs: { baseUrl: "http://api.example.com" } }),
  ).toThrow(/https/);
});

const tool = (http, over = {}) => ({
  key: "search",
  name: "Search",
  description: "Searches",
  kind: "http",
  argsSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  inputs: [
    { id: "apiKey", label: "API key", type: "secret", required: true, defaultValue: null, description: null },
    { id: "baseUrl", label: "Base URL", type: "url", required: true, defaultValue: null, description: null },
  ],
  http: {
    method: "GET",
    url: "https://api.example.com/search",
    headers: {},
    query: {},
    body: null,
    responsePath: null,
    timeoutMs: 15000,
    ...http,
  },
  code: null,
  output: { parser: "auto", transform: null, schema: null },
  requiresApproval: false,
  enabled: true,
  ...over,
});
const messages = (input) => {
  const parsed = toolInputSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

test("save-time validation: origin rule, declared placeholders, secret defaults", () => {
  expect(
    messages(tool({ query: { q: "{{args.q}}" }, headers: { Authorization: "Bearer {{inputs.apiKey}}" } })),
  ).toEqual([]);
  expect(messages(tool({ url: "{{inputs.baseUrl}}/search" }))).toEqual([]);
  expect(messages(tool({ url: "https://{{args.q}}.example.com" })).join()).toMatch(/fixed host/);
  expect(messages(tool({ url: "{{inputs.apiKey}}/x" })).join()).toMatch(/type URL/);
  expect(messages(tool({ query: { x: "{{args.other}}" } })).join()).toMatch(/args\.other/);
  expect(messages(tool({ body: { k: "{{inputs.nope}}" } })).join()).toMatch(/inputs\.nope/);
  const secretDefault = tool(
    {},
    { inputs: [{ id: "k", label: "K", type: "secret", required: false, defaultValue: "x", description: null }] },
  );
  expect(messages(secretDefault).join()).toMatch(/cannot have a default/);
});

test("save-time validation: schemas, transform and code limits", () => {
  expect(messages(tool({}, { argsSchema: { type: "array" } })).join()).toMatch(/arguments schema root/);
  expect(messages(tool({}, { output: { parser: "code", transform: null, schema: null } })).join()).toMatch(
    /transform is required/,
  );
  expect(
    messages(tool({}, { output: { parser: "auto", transform: null, schema: { type: "string" } } })).join(),
  ).toMatch(/output schema root/);
  const code = tool(undefined, { kind: "code", http: null, code: { language: "ruby", source: "x" } });
  expect(messages(code).length).toBeGreaterThan(0);
  const big = tool(undefined, {
    kind: "code",
    http: null,
    code: { language: "python", source: "x".repeat(70 * 1024) },
  });
  expect(messages(big).join()).toMatch(/64 KB/);
  const ok = toolInputSchema.parse(tool(undefined, { kind: "code", code: { language: "python", source: "print(1)" } }));
  expect(ok.http).toBeNull();
});
