import { APIError } from "better-auth/api";
import { expect, test, vi } from "vitest";

// Shared capture buckets. vi.hoisted runs before the hoisted vi.mock factories below.
const state = vi.hoisted(() => ({ options: null, captured: [] }));

vi.mock("better-auth", () => ({
  betterAuth: (options) => {
    state.options = options;
    return {};
  },
}));
vi.mock("@sentry/core", () => ({
  captureException: (error) => state.captured.push(error),
}));
vi.mock("@/lib/authorization/index.ts", () => ({ assertCanDeleteUser: () => {} }));
vi.mock("@/db/index.ts", () => ({
  authAccount: {},
  authSession: {},
  authUser: {},
  authVerification: {},
  userRolesTable: {},
  db: {},
  and: () => {},
  countDistinct: () => {},
  eq: () => {},
}));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => {} }));
vi.mock("@/lib/auth/cachedUserAdapter.ts", () => ({ cachedUserAdapter: (adapter) => adapter }));
vi.mock("@/lib/auth/email.ts", () => ({ sendAuthEmail: async () => {} }));

// Importing auth.ts runs betterAuth(options), capturing the config into `state`.
await import("@/lib/auth/auth.ts");

test("authentication reports unexpected and server errors while keeping expected auth failures quiet", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const report = state.options.onAPIError.onError;
  for (const status of [302, 400, 401, 403, 404, 409, 422, 429]) {
    expect(report(new APIError(status, { message: "Expected authentication failure" }))).toBe(undefined);
  }
  expect(state.captured).toEqual([]);
  expect(log.mock.calls.length).toBe(0);

  const cause = new Error("Database failed to connect to postgres://user:pw@db.internal/app");
  const errors = [cause, new APIError("INTERNAL_SERVER_ERROR", { cause }), new APIError(503, { cause })];
  for (const error of errors) expect(report(error)).toBe(undefined);
  expect(state.captured).toEqual(errors);
  const lines = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(lines.map(({ level, event }) => [level, event])).toEqual(errors.map(() => ["error", "auth.request_failed"]));
  // Messages are logged for diagnosis, but connection credentials in them are masked.
  expect(lines[0].error.message).toBe("Database failed to connect to [hidden]");
  expect(JSON.stringify(lines)).not.toMatch(/user:pw|db\.internal/);

  log.mockRestore();
});
