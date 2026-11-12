import { AsyncLocalStorage } from "node:async_hooks";
import { expect, test, vi } from "vitest";

// The Next.js runtime provides this global; the locale middleware in the proxy needs it.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

// Imported after the global is set: Next reads it once, when its modules load.
const { NextRequest } = await import("next/server.js");
const { default: nextTesting } = await import("next/experimental/testing/server.js");
const { unstable_doesMiddlewareMatch: doesProxyMatch } = nextTesting;

// vi.hoisted runs before the hoisted vi.mock factory below so the fake session
// service can read the fixture the test mutates.
const fixture = vi.hoisted(() => ({ session: null, error: null, queries: 0 }));

vi.mock("@/lib/auth/index.ts", () => ({
  auth: {
    api: {
      async getSession({ query }) {
        fixture.queries++;
        if (!query.disableCookieCache) throw new Error("Must read current status");
        if (fixture.error) throw fixture.error;
        return fixture.session;
      },
    },
  },
}));

const { proxy, config } = await import("@/proxy.ts");

test("suspension blocks pages, actions and APIs while preserving identity and logout", async () => {
  const request = (path, method = "GET", cookie = "smarttools.session_token=test") =>
    new NextRequest(`http://localhost:3000${path}`, { method, headers: { cookie } });
  // Signed-out visitors skip the session lookup; the public home page is served under its locale prefix.
  expect((await proxy(request("/", "GET", ""))).headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/en");
  expect(fixture.queries).toBe(0);
  for (const session of [null, { user: { status: "active" } }]) {
    fixture.session = session;
    // Active (or signed-out) visitors are not blocked; the public page is served under its locale prefix.
    const response = await proxy(request("/paperwork"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost:3000/en/paperwork");
  }
  fixture.session = { user: { status: "suspended" } };
  for (const path of [
    "/",
    "/paperwork",
    "/devtools/json-formatter",
    "/media",
    "/admin",
    "/admin/denied",
    "/auth",
    "/auth/profile",
    "/media/file.pdf",
  ]) {
    expect(doesProxyMatch({ config, url: path })).toBeTruthy();
    const response = await proxy(request(path));
    expect(response.headers.get("location")).toBe("http://localhost:3000/account/suspended");
    expect(response.status).toBe(303);
  }
  for (const path of [
    "/api/tools/search",
    "/api/paperwork/invoices",
    "/api/auth/update-user",
    "/api/auth/delete-user",
    "/api/auth/sign-out/extra",
  ]) {
    expect(doesProxyMatch({ config, url: path })).toBeTruthy();
    const response = await proxy(request(path, "POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("ACCOUNT_SUSPENDED");
  }
  expect((await proxy(request("/admin", "POST"))).status).toBe(403);
  expect((await proxy(request("/account/suspended", "POST"))).status).toBe(403);
  for (const [path, method] of [
    ["/account/suspended", "GET"],
    ["/account/suspended", "HEAD"],
    ["/api/auth/get-session", "GET"],
    ["/api/auth/sign-out", "POST"],
  ]) {
    expect((await proxy(request(path, method))).headers.get("x-middleware-next")).toBe("1");
  }
  fixture.error = new Error("database unavailable");
  const unavailable = await proxy(request("/paperwork"));
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "database unavailable" });
  fixture.error = new Error("");
  expect(await (await proxy(request("/paperwork"))).json()).toEqual({
    error: "Unable to check account access. Please try again.",
  });
  expect((await proxy(request("/api/auth/sign-out", "POST"))).headers.get("x-middleware-next")).toBe("1");
  for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico"]) {
    expect(doesProxyMatch({ config, url: path })).toBe(false);
  }
});
