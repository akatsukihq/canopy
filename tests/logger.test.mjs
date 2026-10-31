import { afterEach, expect, test, vi } from "vitest";
import { log, logError } from "../lib/observability/logger.ts";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

test("logs one JSON line per event and honors LOG_LEVEL", () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  log("debug", "hidden");
  log("info", "shown", { tool: "json-formatter" });
  log("warn", "slow");
  expect(out).toHaveBeenCalledTimes(1);
  expect(JSON.parse(out.mock.calls[0][0])).toMatchObject({ level: "info", event: "shown", tool: "json-formatter" });
  expect(err).toHaveBeenCalledTimes(1);

  process.env.LOG_LEVEL = "error";
  log("info", "also-hidden");
  expect(out).toHaveBeenCalledTimes(1);
});

test("logError keeps stack frames but masks secrets and SQL parameters", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("Failed query: select 1\nparams: secret-value postgres://user:pw@host/db");
  logError("db.failed", error, { path: "/x" });
  const line = JSON.parse(err.mock.calls[0][0]);
  expect(line).toMatchObject({ level: "error", event: "db.failed", path: "/x", error: { name: "Error" } });
  expect(line.error.stack.length).toBeGreaterThan(0);
  expect(err.mock.calls[0][0]).not.toMatch(/secret-value|user:pw/);
});
