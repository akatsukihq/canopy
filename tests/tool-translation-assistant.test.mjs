import { beforeEach, expect, test, vi } from "vitest";

const permission = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("server-only", () => ({}));
vi.mock("../db/index.ts", () => ({ eq: () => ({}), managedToolsTable: { toolId: "tool_id" } }));
vi.mock("../lib/admin/index.ts", () => ({ requirePermission: (...args) => permission(...args) }));
vi.mock("../lib/admin/adminMutations.ts", () => ({
  requireTransactionPermission: (_tx, ...args) => permission(...args),
}));

const { toolTranslationAssistantIntegration: integration, proposeTranslation, translationInstructions } =
  await import("../lib/tool-framework/translationAssistant.ts");

const english = { name: "Hello {name}", count: "{n, plural, one {# item} other {# items}}" };
const base = {
  schemaVersion: 1,
  clientRequestId: "r1",
  operation: "chat",
  message: "Suggest",
  resourceId: "tool-a",
  threadId: "t1",
  context: { locale: "fr", english, current: {}, selectedKeys: ["name"] },
};
const request = () => integration.validateRequest(base);

beforeEach(() => permission.mockClear());

test("context carries only this tool's messages and rejects foreign fields", () => {
  const prompt = translationInstructions(request());
  expect(prompt).toContain("Hello {name}");
  expect(() =>
    integration.validateRequest({ ...base, context: { ...base.context, selectedKeys: ["other.tool.key"] } }),
  ).toThrow(/belong to this tool/);
  expect(() =>
    integration.validateRequest({ ...base, context: { ...base.context, otherTools: { x: "y" } } }),
  ).toThrow();
  expect(() => integration.validateRequest({ ...base, context: { ...base.context, locale: "en" } })).toThrow();
  expect(() => integration.validateRequest({ ...base, attachmentIds: ["a"] })).toThrow();
});

test("suggestions are validated; invalid placeholders cannot be applied", () => {
  const req = request();
  const ok = proposeTranslation("a", { key: "name", text: "Bonjour {name}" }, req, []);
  expect(ok.proposal.data.error).toBeUndefined();
  const bad = proposeTranslation("b", { key: "name", text: "Bonjour {nom}" }, req, []);
  expect(bad.proposal.data.error).toMatch(/same placeholders/);
  expect(proposeTranslation("c", { key: "missing", text: "x" }, req, []).proposal).toBeUndefined();
  expect(proposeTranslation("d", { key: "name", text: "  " }, req, []).proposal).toBeUndefined();
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
  for (const hook of ["complete", "auxiliary", "reserveResource"]) expect(integration[hook]).toBeUndefined();
});
