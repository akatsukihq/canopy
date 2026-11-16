import { beforeEach, expect, test, vi } from "vitest";

// Live network test: talks to the public Parallel MCP server (no auth needed).
const LIVE_URL = "https://mcp.parallel.ai/mcp";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/index.ts", () => ({ db: { transaction: async (fn) => fn({}) } }));
vi.mock("@/lib/admin/access", () => ({ getActorUserId: async () => "admin-1" }));
vi.mock("@/lib/admin/adminMutations.ts", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/admin/index.ts", () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/observability/sentry.ts", () => ({ measureServerAction: (_name, fn) => fn() }));
vi.mock("@/lib/observability/logger.ts", () => ({ logError: vi.fn() }));
vi.mock("@/lib/agents/toolStore", () => ({}));
vi.mock("@/lib/agents/toolRuntime", () => ({}));
vi.mock("@/lib/agents/toolConnections.ts", () => ({ toolConnectionInputSchema: {}, bindConnection: vi.fn() }));
vi.mock("@/lib/agents/openApiImport.ts", () => ({}));

const store = vi.hoisted(() => ({
  createMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  saveMcpToolCache: vi.fn(),
  loadMcpServerRuntime: vi.fn(),
}));
vi.mock("@/lib/agents/store.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  ...store,
}));

const { saveMcpServer } = await import("../app/admin/(protected)/agents/actions.ts");

const input = (url) => ({ name: "Parallel", url, transport: "http", enabled: true, headers: {} });
const row = (url) => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Parallel",
  url,
  transport: "http",
  enabled: true,
  headerNames: [],
  tools: [],
  lastCheckedAt: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
});

beforeEach(() => {
  for (const mock of Object.values(store)) mock.mockReset();
  store.createMcpServer.mockImplementation(async (value) => row(value.url));
  store.updateMcpServer.mockImplementation(async (_id, value) => row(value.url));
});

test("a reachable server is saved with its tools cached", { timeout: 40_000 }, async () => {
  const result = await saveMcpServer(null, input(LIVE_URL));
  expect(result.ok).toBe(true);
  expect(result.data.tools.length).toBeGreaterThan(0);
  expect(result.data.lastError).toBeNull();
  expect(store.createMcpServer).toHaveBeenCalledTimes(1);
  expect(store.saveMcpToolCache).toHaveBeenCalledWith(row(LIVE_URL).id, result.data.tools, null);
});

test("an unreachable server is not saved", { timeout: 40_000 }, async () => {
  const result = await saveMcpServer(null, input("https://mcp.parallel.ai/does-not-exist"));
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/^Not saved\./);
  expect(store.createMcpServer).not.toHaveBeenCalled();
  expect(store.saveMcpToolCache).not.toHaveBeenCalled();
});

test("editing checks the new settings before updating", { timeout: 40_000 }, async () => {
  store.loadMcpServerRuntime.mockResolvedValue({ headers: {} });
  const bad = await saveMcpServer("id-1", input("https://mcp.parallel.ai/does-not-exist"));
  expect(bad.ok).toBe(false);
  expect(store.updateMcpServer).not.toHaveBeenCalled();
  const good = await saveMcpServer("id-1", input(LIVE_URL));
  expect(good.ok).toBe(true);
  expect(store.updateMcpServer).toHaveBeenCalledTimes(1);
});

test("a kept header with no stored value is rejected before connecting", async () => {
  store.loadMcpServerRuntime.mockResolvedValue({ headers: {} });
  const result = await saveMcpServer("id-1", { ...input(LIVE_URL), headers: { Authorization: null } });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Authorization needs a value/);
  expect(store.updateMcpServer).not.toHaveBeenCalled();
});
