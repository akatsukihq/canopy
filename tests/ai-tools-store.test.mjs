import { beforeEach, expect, test, vi } from "vitest";

process.env.SETTINGS_ENCRYPTION_KEY = "test-key-that-is-at-least-32-characters-long";

vi.mock("server-only", () => ({}));
const tx = { users: [], deleted: false };
vi.mock("@/db/index.ts", () => {
  const chain = () => {
    const query = {
      select: () => query,
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      orderBy: async () => tx.users,
    };
    return query;
  };
  const handle = {
    execute: async () => undefined,
    select: () => chain(),
    delete: () => ({ where: async () => (tx.deleted = true) }),
  };
  return {
    db: { transaction: async (fn) => fn(handle) },
    aiAgentsTable: { id: "id", name: "name" },
    aiAgentToolsTable: { agentId: "agent_id", toolId: "tool_id" },
    aiToolsTable: { id: "id", name: "name" },
    asc: () => undefined,
    eq: () => undefined,
    sql: Object.assign(() => undefined, { raw: () => undefined }),
    inArray: () => undefined,
  };
});

const { encodeAttachmentInputs, decodeAttachmentInputs, publicAttachment, approvalInGenerationError } =
  await import("../lib/agents/toolAttachments.ts");
const { deleteTool } = await import("../lib/agents/toolStore.ts");

const tool = {
  id: "tool-1",
  name: "Search",
  inputs: [
    { id: "apiKey", label: "API key", type: "secret", required: true, defaultValue: null, description: null },
    { id: "region", label: "Region", type: "text", required: true, defaultValue: "eu", description: null },
    { id: "base", label: "Base URL", type: "url", required: false, defaultValue: null, description: null },
    { id: "limit", label: "Limit", type: "number", required: false, defaultValue: null, description: null },
  ],
};

test("secrets round-trip encrypted and bound to the agent, tool and field", () => {
  const encoded = encodeAttachmentInputs("agent-1", tool, { apiKey: "sk-1", region: "us", base: null, limit: "5" });
  expect(encoded.ok).toBe(true);
  expect(JSON.stringify(encoded.value)).not.toContain("sk-1");
  expect(decodeAttachmentInputs("agent-1", tool, encoded.value)).toEqual({
    ok: true,
    value: { apiKey: "sk-1", region: "us", limit: "5" },
  });
  const moved = decodeAttachmentInputs("agent-2", tool, encoded.value);
  expect(moved.ok).toBe(false);
  expect(moved.error).toMatch(/could not be decrypted/);
});

test("a null secret keeps the stored value; empty clears it; required inputs are enforced", () => {
  const first = encodeAttachmentInputs("agent-1", tool, { apiKey: "sk-1" }).value;
  const kept = encodeAttachmentInputs("agent-1", tool, { apiKey: null, region: "us" }, first);
  expect(kept.value.apiKey).toEqual(first.apiKey);
  expect(encodeAttachmentInputs("agent-1", tool, { apiKey: "" }, first)).toEqual({
    ok: false,
    error: '"Search": enter API key.',
  });
  expect(encodeAttachmentInputs("agent-1", tool, { apiKey: null }).ok).toBe(false);
  expect(encodeAttachmentInputs("agent-1", tool, { apiKey: "k", base: "http://x.example" }).error).toMatch(/https/);
  expect(encodeAttachmentInputs("agent-1", tool, { apiKey: "k", limit: "many" }).error).toMatch(/number/);
  expect(encodeAttachmentInputs("agent-1", tool, { apiKey: "k", other: "x" }).error).toMatch(/no input named other/);
});

test("the browser view never carries secret values", () => {
  const stored = encodeAttachmentInputs("agent-1", tool, { apiKey: "sk-1", region: "us" }).value;
  const view = publicAttachment("tool-1", stored);
  expect(view).toEqual({ toolId: "tool-1", inputs: { region: "us" }, savedSecrets: ["apiKey"] });
  expect(JSON.stringify(view)).not.toMatch(/sk-1|ciphertext|iv/);
});

const agent = (id, over = {}) => ({
  id,
  name: id,
  sections: [],
  subagents: { mode: "none", agentIds: [] },
  toolIds: [],
  ...over,
});
const approval = new Map([["tool-1", "Search"]]);

test("approval tools cannot be reached from blog generation directly, via delegate or via pipeline", () => {
  expect(
    approvalInGenerationError([agent("a", { sections: ["blog-editor"], toolIds: ["tool-1"] })], approval),
  ).toBeNull();
  expect(
    approvalInGenerationError([agent("a", { sections: ["blog-generation"], toolIds: ["tool-1"] })], approval),
  ).toMatch(/"Search" tool needs approval, so "a"/);
  for (const mode of ["delegate", "pipeline"]) {
    const graph = [
      agent("root", { sections: ["blog-generation"], subagents: { mode, agentIds: ["mid"] } }),
      agent("mid", { subagents: { mode: "delegate", agentIds: ["leaf"] } }),
      agent("leaf", { toolIds: ["tool-1"] }),
    ];
    expect(approvalInGenerationError(graph, approval)).toMatch(/"leaf" cannot use it .* through "root"/);
  }
  const off = [
    agent("root", { sections: ["blog-generation"], subagents: { mode: "none", agentIds: ["leaf"] } }),
    agent("leaf", { toolIds: ["tool-1"] }),
  ];
  expect(approvalInGenerationError(off, approval)).toBeNull();
});

beforeEach(() => {
  tx.users = [];
  tx.deleted = false;
});

test("deleting a tool an agent uses is refused and names the agents", async () => {
  tx.users = [{ name: "Researcher" }, { name: "Writer" }];
  await expect(deleteTool("tool-1")).rejects.toThrow("Attached to Researcher, Writer. Detach it there first.");
  expect(tx.deleted).toBe(false);
  tx.users = [];
  await deleteTool("tool-1");
  expect(tx.deleted).toBe(true);
});
