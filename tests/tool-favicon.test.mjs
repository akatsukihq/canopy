import { afterEach, beforeEach, expect, test, vi } from "vitest";
import nextTesting from "next/experimental/testing/server.js";

const stored = vi.hoisted(() => ({ rows: [], configured: true }));
vi.mock("@/lib/auth/index.ts", () => ({ auth: {} }));
vi.mock("@/db/index.ts", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => stored.rows };
  return {
    db: { select: () => chain },
    isDatabaseConfigured: () => stored.configured,
    managedToolsTable: { icon: "icon" },
    and: () => null,
    sql: () => null,
  };
});

const { resolveIcon, toolFaviconHref } = await import("@/lib/tool-framework/icons.ts");
const { GET } = await import("@/app/tool-icons/[...path]/route.ts");
const { config } = await import("@/proxy.ts");

afterEach(() => vi.restoreAllMocks());

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKo8AAAAASUVORK5CYII=",
  "base64",
);
const toolId = "media.resize-image";
const media = (entry = {}) => ({
  v: 1,
  provider: "cloudinary",
  format: "png",
  width: 104,
  height: 88,
  uploadedAt: "2026-09-17T00:00:00Z",
  entry: { cloudName: "favicon-test", publicId: "smarttools/tool-icons/media.resize-image", version: 123, ...entry },
});
const validPath = ["favicon-test", "v123", "smarttools", "tool-icons", "media.resize-image.png"];
const request = (pathname = "/tool-icons/" + validPath.join("/")) =>
  new Request("https://app.example" + pathname, {
    headers: { Cookie: "session=private-session", Authorization: "Bearer private-token" },
  });
const call = (path = validPath) => GET(request(), { params: Promise.resolve({ path }) });

beforeEach(() => {
  stored.rows = [{ icon: media() }];
  stored.configured = true;
});

test("uploaded tool favicons round-trip through a versioned same-origin PNG URL", async () => {
  const requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    requests.push({ input, options });
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  const href = toolFaviconHref(resolveIcon(toolId, "Resize image", media()));
  expect(href).toBe("/tool-icons/favicon-test/v123/smarttools/tool-icons/media.resize-image.png");
  expect(
    toolFaviconHref(resolveIcon(toolId, "Resize image", media({ version: 124 }))),
    "replaced icons receive a different browser cache key",
  ).toBe("/tool-icons/favicon-test/v124/smarttools/tool-icons/media.resize-image.png");
  const url = new URL(href, "https://app.example");
  const path = url.pathname.slice("/tool-icons/".length).split("/").map(decodeURIComponent);
  const response = await GET(request(href), { params: Promise.resolve({ path }) });
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Cache-Control")).toMatch(/public/);
  expect(response.headers.get("Cache-Control")).toMatch(/max-age=[1-9]\d*/);
  expect(response.headers.get("Location")).toBe(null);
  expect(requests.length).toBe(1);
  const [{ input, options }] = requests;
  expect(String(input)).toBe(
    "https://res.cloudinary.com/favicon-test/image/upload/f_png,c_fill,w_256,h_256,q_auto/v123/smarttools/tool-icons/media.resize-image.png",
  );
  expect(options.redirect).toBe("error");
  expect(options.signal instanceof AbortSignal, "upstream request has a timeout signal").toBeTruthy();
  const headers = new Headers(options.headers);
  expect(headers.get("Cookie")).toBe(null);
  expect(headers.get("Authorization")).toBe(null);

  const escapedMedia = media({ publicId: "smarttools/tool-icons/resize image + café" });
  stored.rows = [{ icon: escapedMedia }];
  const escaped = toolFaviconHref(resolveIcon(toolId, "Resize image", escapedMedia));
  expect(escaped).toBe("/tool-icons/favicon-test/v123/smarttools/tool-icons/resize%20image%20%2B%20caf%C3%A9.png");
  const escapedPath = escaped.slice("/tool-icons/".length).split("/").map(decodeURIComponent);
  const escapedResponse = await GET(request(escaped), { params: Promise.resolve({ path: escapedPath }) });
  expect(escapedResponse.status).toBe(200);
  expect(Buffer.from(await escapedResponse.arrayBuffer())).toEqual(png);
  expect(String(requests[1].input)).toBe(
    "https://res.cloudinary.com/favicon-test/image/upload/f_png,c_fill,w_256,h_256,q_auto/v123/smarttools/tool-icons/resize%20image%20%2B%20caf%C3%A9.png",
  );
});

test("stored icons resolve from their own account, not the configured cloud", () => {
  const icon = media({ cloudName: "older-account" });
  expect(resolveIcon(toolId, "Resize image", icon).url).toBe(
    "https://res.cloudinary.com/older-account/image/upload/f_png,c_fill,w_256,h_256,q_auto/v123/smarttools/tool-icons/media.resize-image.png",
  );
});

test("generated fallback SVG remains a correctly escaped data URI", () => {
  {
    const icon = resolveIcon("tool-fallback", "<script &test", null);
    expect(icon.kind).toBe("svg");
    const href = toolFaviconHref(icon);
    expect(href).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(href.split(",").slice(1).join(","))).toBe(icon.svg);
    expect(icon.svg).toMatch(/&lt;&amp;/);
    expect(href).not.toMatch(/[<>\s#]/);
  }
});

test("invalid favicon paths never issue an upstream request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("Invalid path reached the network");
  });
  for (const path of [
    undefined,
    "v123/icon.png",
    ["bad cloud!", "v123", "icon.png"],
    ["v123", "folder", "icon.png"],
    [],
    ["favicon-test", "v123"],
    ["favicon-test", "123", "icon.png"],
    ["favicon-test", "v0", "icon.png"],
    ["favicon-test", "v-1", "icon.png"],
    ["favicon-test", "v1.5", "icon.png"],
    ["favicon-test", "v123", "..", "icon.png"],
    ["favicon-test", "v123", ".", "icon.png"],
    ["favicon-test", "v123", "", "icon.png"],
    ["favicon-test", "v123", "%2e%2e", "icon.png"],
    ["favicon-test", "v123", "https://example.com", "icon.png"],
    ["favicon-test", "v123", "safe/../private.png"],
    ["favicon-test", "v123", "safe\\private.png"],
    ["favicon-test", "v123", "icon.png?url=https://example.com"],
    ["favicon-test", "v123", "icon.png#fragment"],
    ["favicon-test", "v123", "icon.svg"],
    ["favicon-test", "v123", "icon.jpg"],
    ["favicon-test", "v123", ".png"],
    ["favicon-test", "v123", "\u0000icon.png"],
    ["favicon-test", "v123", "a".repeat(1025) + ".png"],
    ["favicon-test", "v123", ...Array(16).fill("folder"), "icon.png"],
  ]) {
    const response = await GET(request(), { params: Promise.resolve({ path }) });
    expect(response.status, String(JSON.stringify(path))).toBe(404);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  }
  expect(fetch.mock.calls.length).toBe(0);
});

test("public favicon files bypass session lookups without bypassing page or API protection", () => {
  const { unstable_doesMiddlewareMatch: doesProxyMatch } = nextTesting;
  for (const url of [
    "/tool-icons/favicon-test/v123/smarttools/tool-icons/media.resize-image.png",
    "/tool-icons/demo/v124/Canopy/platform/assets/default/icons/extract-pdf-pages.png",
  ]) {
    expect(doesProxyMatch({ config, url }), url).toBe(false);
  }
  for (const url of ["/media/extract-pdf-pages", "/devtools/json-editor", "/api/tools/search", "/tool-icons-other"]) {
    expect(doesProxyMatch({ config, url }), url).toBe(true);
  }
});

test("icons no tool stores are never proxied", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("Unstored icon reached the network");
  });
  for (const setup of [
    () => (stored.rows = []),
    () => (stored.rows = [{ icon: "https://example.com/icon.png" }]),
    () => (stored.configured = false),
  ]) {
    setup();
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  }
  expect(fetch.mock.calls.length).toBe(0);
});

test("upstream redirects, non-PNG responses, failures and timeouts never become cached favicons", async () => {
  const responses = [
    () => new Response("unavailable", { status: 404 }),
    () => new Response("unavailable", { status: 500 }),
    () => new Response(null, { status: 302, headers: { Location: "https://example.com/icon.png" } }),
    () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    () => new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } }),
    () => {
      throw new Error("private-upstream-detail");
    },
    () => {
      throw new DOMException("private-upstream-detail", "TimeoutError");
    },
  ];
  let current;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => current());
  for (current of responses) {
    const response = await call();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(response.headers.get("Content-Type")).not.toBe("image/png");
    expect(response.headers.get("Location")).toBe(null);
    expect(await response.text()).not.toMatch(/private-upstream-detail/);
  }
});
