import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/index.ts", () => ({}));

const { validateAgentGraph, assertHeadersAllowedForUrl, describeMcpFailure } = await import("@/lib/agents/store.ts");
const { agentInputSchema, mcpServerInputSchema, outputSchemaSchema } = await import("@/lib/agents/types.ts");

const input = (over = {}) => ({
  key: "writer",
  name: "Writer",
  description: "Writes",
  command: null,
  aliases: [],
  persona: "Be helpful",
  model: null,
  effort: "medium",
  sections: ["blog-editor"],
  defaultFor: [],
  outputSchema: null,
  proposesDocument: false,
  requiresDocument: false,
  webSearch: false,
  builtinTools: [],
  skillIds: [],
  mcpTools: [],
  subagents: { mode: "none", agentIds: [] },
  enabled: true,
  ...over,
});
const stored = (id, over = {}) => ({
  ...input({ key: id, name: id, ...over }),
  id,
  version: 1,
  updatedAt: "",
  updatedBy: null,
});
const delegate = (...agentIds) => ({ mode: "delegate", agentIds });

test("accepts a valid new agent with an enabled subagent", () => {
  expect(() => validateAgentGraph(null, input({ subagents: delegate("a") }), [stored("a")])).not.toThrow();
});

test("rejects missing, disabled and self-referencing subagents", () => {
  expect(() => validateAgentGraph(null, input({ subagents: delegate("x") }), [])).toThrow(/no longer exists/);
  expect(() =>
    validateAgentGraph(null, input({ subagents: delegate("a") }), [stored("a", { enabled: false })]),
  ).toThrow(/turned off/);
  expect(() => validateAgentGraph("a", input({ subagents: delegate("a") }), [stored("a")])).toThrow(/own subagent/);
});

test("rejects a cycle created by the edit", () => {
  const all = [stored("a", { subagents: delegate("b") }), stored("b")];
  expect(() => validateAgentGraph("b", input({ subagents: delegate("a") }), all)).toThrow(/loop/);
});

test("rejects nesting deeper than the limit, including by editing a leaf", () => {
  const all = [stored("a", { subagents: delegate("b") }), stored("b", { subagents: delegate("c") }), stored("c")];
  expect(() => validateAgentGraph(null, input({ subagents: delegate("a") }), all)).toThrow(/levels deep/);
  expect(() => validateAgentGraph("c", input({ subagents: delegate("d") }), [...all, stored("d")])).toThrow(
    /levels deep/,
  );
  expect(() => validateAgentGraph(null, input({ subagents: delegate("b") }), all)).not.toThrow();
});

test("command must be unique among enabled agents in a shared section", () => {
  const all = [stored("a", { command: "plan", sections: ["blog-editor"] })];
  expect(() => validateAgentGraph(null, input({ command: "plan" }), all)).toThrow(/\/plan/);
  expect(() => validateAgentGraph(null, input({ command: "plan", sections: ["tool-content"] }), all)).not.toThrow();
  expect(() => validateAgentGraph(null, input({ command: "plan", enabled: false }), all)).not.toThrow();
  expect(() => validateAgentGraph("a", input({ command: "plan" }), all)).not.toThrow();
});

test("a default section must be an available section", () => {
  expect(agentInputSchema.safeParse(input({ defaultFor: ["tool-content"] })).success).toBe(false);
  expect(agentInputSchema.safeParse(input({ defaultFor: ["blog-editor"] })).success).toBe(true);
});

test("cannot turn off an agent that enabled agents use as a subagent", () => {
  const all = [stored("a", { subagents: delegate("b") }), stored("b")];
  expect(() => validateAgentGraph("b", input({ enabled: false }), all)).toThrow(/Used as a subagent by a/);
  const offUser = [stored("a", { subagents: delegate("b"), enabled: false }), stored("b")];
  expect(() => validateAgentGraph("b", input({ enabled: false }), offUser)).not.toThrow();
});

const server = (url) => ({ name: "S", url, transport: "http", headers: {}, enabled: true });

test("MCP urls with a query string or fragment are rejected", () => {
  expect(mcpServerInputSchema.safeParse(server("https://mcp.example.com/mcp")).success).toBe(true);
  const withQuery = mcpServerInputSchema.safeParse(server("https://mcp.example.com/mcp?token=abc"));
  expect(withQuery.success).toBe(false);
  expect(withQuery.error.issues[0].message).toBe("Put credentials in headers, not the URL.");
  expect(mcpServerInputSchema.safeParse(server("https://mcp.example.com/mcp#x")).success).toBe(false);
});

test("saved header values cannot follow a changed server origin", () => {
  const keep = { Authorization: null };
  expect(() => assertHeadersAllowedForUrl("https://a.example.com/mcp", "https://b.example.com/mcp", keep)).toThrow(
    /Re-enter header values/,
  );
  expect(() =>
    assertHeadersAllowedForUrl("https://a.example.com/mcp", "https://b.example.com/mcp", { Authorization: "new" }),
  ).not.toThrow();
  expect(() =>
    assertHeadersAllowedForUrl("https://a.example.com/mcp", "https://a.example.com/other", keep),
  ).not.toThrow();
});

test("MCP failures map to fixed messages without echoing raw text", () => {
  const secret = "Bearer sk-secret-123";
  const cases = [
    [`HTTP 401 ${secret}`, /rejected the credentials/],
    [`status 404 ${secret}`, /HTTP 404/],
    ["MCP servers must use a public HTTPS address.", /blocked/],
    ["The operation was aborted due to timeout", /in time/],
    ["The MCP server host could not be resolved.", /could not be reached/],
    [`invalid JSON ${secret}`, /not valid MCP/],
    [`weird ${secret}`, /could not be reached/],
  ];
  for (const [raw, expected] of cases) {
    const message = describeMcpFailure(new Error(raw));
    expect(message).toMatch(expected);
    expect(message).not.toContain("sk-secret");
    expect(message.length).toBeLessThanOrEqual(300);
  }
  expect(describeMcpFailure("nonsense")).toMatch(/could not be reached/);
});

test("output schema rejects keywords that would not be enforced, but allows properties with those names", () => {
  const withContains = {
    type: "object",
    properties: { keywords: { type: "array", items: { type: "string" }, contains: { const: "x" }, minContains: 1 } },
  };
  expect(outputSchemaSchema.safeParse(withContains).success).toBe(false);
  const propertyNamedContains = {
    type: "object",
    properties: { contains: { type: "string" } },
    required: ["contains"],
  };
  expect(outputSchemaSchema.safeParse(propertyNamedContains).success).toBe(true);
});
