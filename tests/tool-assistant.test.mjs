import { beforeEach, expect, test, vi } from "vitest";
import { toolSpec } from "./helpers/toolSpec.mjs";

const permission = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/tool-framework/systemLimits.ts", async (original) => ({
  ...(await original()),
  loadSystemLimits: async () => ({}),
}));
vi.mock("../lib/admin/index.ts", async (original) => ({
  ...(await original()),
  requirePermission: (...args) => permission(...args),
}));
vi.mock("../lib/admin/adminMutations.ts", async (original) => ({
  ...(await original()),
  requireTransactionPermission: (_tx, ...args) => permission(...args),
}));

const { db } = await import("../db/index.ts");
const {
  toolAssistantIntegration: integration,
  loadToolAssistantData,
  proposeContent,
  proposeDefinition,
  proposeTranslation,
  toolAssistantInstructions,
} = await import("../lib/tool-framework/toolAssistant.ts");

const spec = await toolSpec("gradient-generator");
const english = { name: "Hello {name}", description: "A tool" };
const row = {
  toolId: spec.toolId,
  app: spec.app,
  slug: "gradient",
  name: "Hello {name}",
  description: "A tool",
  spec: null,
  specDraft: spec,
  translations: { en: { status: "published", messages: english }, fr: { status: "draft", messages: { name: "Salut {name}" } } },
};
const roster = [
  { id: spec.toolId, name: "Gradient" },
  { id: "devtools.other", name: "Other" },
];

/** db.select() answers queued rows in call order; all reads here are by tool id. */
function queueReads(...results) {
  db.select = () => {
    const result = results.shift();
    const chain = { from: () => chain, where: () => chain, limit: () => chain, then: (ok, fail) => Promise.resolve(result).then(ok, fail) };
    return chain;
  };
}
const load = async () => {
  queueReads([row], [{ seoTitle: "Stored title", category: null, keywords: null, seoDescription: null, contentDoc: null }], roster);
  return loadToolAssistantData(spec.toolId);
};

const base = {
  schemaVersion: 1,
  clientRequestId: "r1",
  operation: "chat",
  message: "Suggest",
  resourceId: spec.toolId,
  threadId: "t1",
  context: { section: "translations", locale: "fr", selectedKeys: ["name"] },
};

beforeEach(() => {
  permission.mockClear();
});

test("the browser sends only its position; tool data comes from the database", async () => {
  const request = integration.validateRequest(base);
  const prompt = toolAssistantInstructions(request, await load());
  expect(prompt).toContain("Hello {name}");
  expect(prompt).toContain("Stored title");
  expect(prompt).toContain("Salut {name}");
  for (const extra of [{ english: { x: "y" } }, { current: {} }, { spec: {} }])
    expect(() => integration.validateRequest({ ...base, context: { ...base.context, ...extra } })).toThrow();
  expect(() => integration.validateRequest({ ...base, context: { section: "translations" } })).toThrow();
  expect(() => integration.validateRequest({ ...base, context: { section: "translations", locale: "en" } })).toThrow();
  expect(() => integration.validateRequest({ ...base, attachmentIds: ["a"] })).toThrow();
  queueReads([]);
  await expect(loadToolAssistantData("devtools.missing")).rejects.toThrow(/not found/i);
});

test("content suggestions are checked like the save path; bad ones cannot be applied", async () => {
  const data = await load();
  const ok = proposeContent("a", { field: "seoTitle", value: "A clear title" }, data, []);
  expect(ok.proposal.data).toMatchObject({ section: "overview", field: "seoTitle" });
  expect(ok.proposal.data.error).toBeUndefined();
  const long = proposeContent("b", { field: "seoDescription", value: "x".repeat(321) }, data, []);
  expect(long.proposal.data.error).toMatch(/320/);
  const unknownRelated = proposeContent("c", { field: "relatedToolIds", value: ["devtools.nope"] }, data, []);
  expect(unknownRelated.proposal.data.error).toMatch(/not registered/);
  const self = proposeContent("d", { field: "relatedToolIds", value: [spec.toolId] }, data, []);
  expect(self.proposal.data.error).toMatch(/itself/);
  const related = proposeContent("e", { field: "relatedToolIds", value: ["devtools.other"] }, data, []);
  expect(related.proposal.data).toMatchObject({ section: "content" });
  expect(related.proposal.data.error).toBeUndefined();
  expect(proposeContent("f", { field: "faq", value: [{ q: "Q?", a: "A." }] }, data, []).proposal.data.error).toBeUndefined();
  expect(proposeContent("g", { field: "howToUse", value: [] }, data, []).proposal.data.error).toBeTruthy();
  expect(proposeContent("h", { field: "bogus", value: "x" }, data, []).proposal).toBeUndefined();
});

test("definition suggestions are validated as a whole spec", async () => {
  const data = await load();
  const merged = await proposeDefinition("a", { mode: "merge", spec: { name: "Renamed" } }, data, []);
  expect(merged.proposal.data.error).toBeUndefined();
  expect(JSON.parse(merged.proposal.data.text).name).toBe("Renamed");
  expect(JSON.parse(merged.proposal.data.previous).name).toBe(spec.name);
  const wrongId = await proposeDefinition("b", { mode: "merge", spec: { toolId: "devtools.other" } }, data, []);
  expect(wrongId.proposal.data.error).toMatch(/toolId/);
  const invalid = await proposeDefinition("c", { mode: "replace", spec: { name: "Only" } }, data, []);
  expect(invalid.proposal.data.error).toBeTruthy();
  const second = await proposeDefinition("d", { mode: "merge", spec: {} }, data, [merged.proposal]);
  expect(second.proposal).toBeUndefined();
});

test("translation suggestions keep their per-field checks", async () => {
  const data = await load();
  const ok = proposeTranslation("a", { key: "name", text: "Bonjour {name}" }, data, "fr", []);
  expect(ok.proposal.data).toMatchObject({ previous: "Salut {name}", locale: "fr", section: "translations" });
  expect(ok.proposal.data.error).toBeUndefined();
  expect(proposeTranslation("b", { key: "name", text: "Bonjour {nom}" }, data, "fr", []).proposal.data.error).toMatch(
    /same placeholders/,
  );
  expect(proposeTranslation("c", { key: "missing", text: "x" }, data, "fr", []).proposal).toBeUndefined();
  expect(proposeTranslation("d", { key: "name", text: "  " }, data, "fr", []).proposal).toBeUndefined();
});

test("authorization needs tools.view only and never writes", async () => {
  const writes = vi.fn();
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "tool-a" }] }) }) }),
    insert: writes,
    update: writes,
    delete: writes,
  };
  await integration.authorize(tx, "admin", "tool-a", true, "chat");
  expect(permission).toHaveBeenCalledWith("admin", "tools", "view");
  expect(permission).not.toHaveBeenCalledWith("admin", "tools", "edit");
  expect(writes).not.toHaveBeenCalled();

  permission.mockRejectedValueOnce(new Error("denied"));
  await expect(integration.authorize(tx, "viewer", "tool-a", false, "chat")).rejects.toThrow("denied");
  await integration.authorizeConfiguration("admin");
  expect(permission).toHaveBeenLastCalledWith("admin", "tools", "view");

  const missing = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  await expect(integration.authorize(missing, "admin", "nope", false, "chat")).rejects.toThrow(/not found/i);
});

test("integration has no write hooks", () => {
  expect(integration.key).toBe("tool-admin");
  for (const hook of ["complete", "auxiliary", "reserveResource"]) expect(integration[hook]).toBeUndefined();
});
