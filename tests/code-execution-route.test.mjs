import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ captured: [], logged: [], run: async () => ({ render: "text", text: "ok" }) }));

vi.mock("@sentry/core", () => ({ captureException: (error) => state.captured.push(error) }));
vi.mock("@/lib/observability/logger.ts", () => ({
  log: (...args) => state.logged.push(args),
  logError: (...args) => state.logged.push(args),
}));
// The route reads the spec from the database; both test tools have a row.
vi.mock("@/lib/tool-framework/catalog", () => ({
  loadSpecByDefinitionKey: async (key) => ({ toolId: `devtools.${key}`, app: "devtools", settings: { fields: {} } }),
}));
vi.mock("@/tools/python-compiler/run.server", () => ({ run: (...args) => state.run(...args) }));
vi.mock("@/tools/plain-tool/run.server", () => ({ run: (...args) => state.run(...args) }));

const { POST } = await import("@/app/api/tools/[key]/route.ts");

beforeEach(() => {
  state.captured = [];
  state.logged = [];
  state.run = async () => ({ render: "text", text: "ok" });
});

const post = (key, ip, body = "{}") =>
  POST(new Request(`https://app.test/api/tools/${key}`, { method: "POST", body, headers: { "x-forwarded-for": ip } }), {
    params: Promise.resolve({ key }),
  });

async function statuses(key, ip, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push((await post(key, ip)).status);
  return out;
}

test("code-execution tools are limited to 10 runs per minute in their own bucket", async () => {
  const result = await statuses("python-compiler", "203.0.113.10", 11);
  expect(result.slice(0, 10)).toEqual(Array(10).fill(200));
  expect(result[10]).toBe(429);
  // The code bucket is independent of the per-tool bucket other tools use.
  expect(await statuses("plain-tool", "203.0.113.10", 1)).toEqual([200]);
});

test("existing tools keep the 20 per minute limit", async () => {
  const result = await statuses("plain-tool", "203.0.113.20", 21);
  expect(result.slice(0, 20)).toEqual(Array(20).fill(200));
  expect(result[20]).toBe(429);
});

test("an unexpected failure in a code tool never carries request content to Sentry, logs or the response", async () => {
  state.run = async () => {
    throw new Error("print('TOP-SECRET-SOURCE')");
  };
  const response = await post(
    "python-compiler",
    "203.0.113.30",
    JSON.stringify({ text: "print('TOP-SECRET-SOURCE')" }),
  );
  expect(response.status).toBe(500);
  const everything = JSON.stringify([state.captured.map(String), state.logged, await response.json()]);
  expect(everything).not.toContain("TOP-SECRET-SOURCE");
});
