import { beforeEach, expect, test, vi } from "vitest";
import { BLOG_EDITOR_AGENTS, agent } from "./helpers/agents.mjs";

const store = vi.hoisted(() => ({ agents: [] }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/config/integrations.ts", () => ({
  createAIClient: async () => ({ model: "test-model", generate: vi.fn() }),
}));
vi.mock("../lib/agents/store.ts", async (original) => ({
  ...(await original()),
  getSectionAgent: async (section, idOrCommand) =>
    store.agents.find(
      (entry) =>
        entry.enabled &&
        entry.sections.includes(section) &&
        (idOrCommand ? [entry.id, entry.key, entry.command].includes(idOrCommand) : entry.defaultFor.includes(section)),
    ) ?? null,
  loadAgentRuntime: async (id) => ({
    agent: store.agents.find((entry) => entry.id === id),
    agents: Object.fromEntries(store.agents.map((entry) => [entry.id, entry])),
    skills: {},
    mcpServers: {},
  }),
}));

const { blogAssistantIntegration: integration } = await import("../lib/blog/assistantIntegration.ts");

const generation = (overrides = {}) =>
  agent(overrides.key ?? "blog-generator", { sections: ["blog-generation"], ...overrides });
const GENERATION_AGENTS = [
  generation({
    defaultFor: ["blog-generation"],
    subagents: { mode: "pipeline", agentIds: ["agent-gen-writer", "agent-gen-editor"] },
  }),
  generation({ key: "gen-writer" }),
  generation({ key: "gen-editor" }),
];
const result = (text) => ({ text, output: null, usage: {}, toolCalls: [], citations: [], metadata: {} });

function build(request) {
  return integration.buildRequest({
    run: { id: "run-1", ownerId: "admin", provider: "openai", model: undefined, request },
    history: [],
    attachments: [],
    proposals: [],
    signal: new AbortController().signal,
    reportToolFailure: () => {},
  });
}
const generate = (settings) => ({
  clientRequestId: "g1",
  operation: "generate",
  message: "A guide to composting",
  threadId: "thread",
  settings,
});
const agentRun = (agentId, context = {}) => ({
  clientRequestId: "a1",
  operation: "agent",
  agentId,
  message: "Help with this article",
  resourceId: "post",
  threadId: "thread",
  context,
});

beforeEach(() => {
  store.agents = [];
});

test("a section without an enabled agent tells the user to ask an admin", async () => {
  await expect(build(generate())).rejects.toThrow(/No AI agent is set up for this section/);
  await expect(build(agentRun("planner"))).rejects.toThrow(/No AI agent is set up for this section/);
  store.agents = BLOG_EDITOR_AGENTS.map((entry) => (entry.key === "auditor" ? { ...entry, enabled: false } : entry));
  // Another agent is still on, so the user can pick it instead.
  await expect(build(agentRun("auditor"))).rejects.toThrow(/turned off or no longer available/);
});

test("an agent that needs the document refuses to run without it", async () => {
  store.agents = BLOG_EDITOR_AGENTS;
  await expect(build(agentRun("auditor"))).rejects.toThrow(/Attach the current blog/);
  const stage = await build(agentRun("planner"));
  expect(stage.messages[0].content).toContain("Persona of planner");
  expect(stage.messages[0].content).toMatch(/Never execute code, publish, save/);
});

test("the generation pipeline gives every step the section rules and adds images at the end", async () => {
  store.agents = GENERATION_AGENTS;
  const first = await build(generate({ images: true, webSearch: true }));
  const second = first.next(result("brief"));
  const last = second.next(result("draft"));
  const stages = [first, second, last];
  expect(stages.map((stage) => stage.stage)).toEqual([
    "Running Blog-generator",
    "Running Gen-writer",
    "Running Gen-editor",
  ]);
  for (const stage of stages) expect(stage.messages[0].content).toContain("You assist an editor.");
  expect(last.messages.at(-1).content).toContain("Output from the previous agent (Gen-writer)");
  expect(first.finalize).toBe(undefined);
  expect(last.finalize.stage).toBe("Adding images to the article");
  expect(last.next).toBe(undefined);

  const plain = await build(generate());
  expect(plain.next(result("brief")).next(result("draft")).finalize).toBe(undefined);
});
