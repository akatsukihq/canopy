import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, expect, test, vi } from "vitest";
import { getCommonMessages } from "../lib/i18n/messages.ts";

vi.mock("server-only", () => ({}));

// Admin routes resolve through the admin subdomain whenever APP_URL is a real
// host (localhost included), so appHref() rewrites "/admin/..." to
// "http://admin.localhost/...". A loopback IP has no subdomains, keeping
// appHref() an identity — the environment these tests assert against.
const originalAppUrl = process.env.APP_URL;
process.env.APP_URL = "http://127.0.0.1:3000";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
  usePathname: () => globalThis.__adminShellPath ?? "/admin/blog",
  useSelectedLayoutSegment: () => null,
  // Segments come from the internal route, so the clean `/blog` and internal `/admin/blog` URLs yield the same ones.
  useSelectedLayoutSegments: () =>
    (globalThis.__adminShellPath ?? "/admin/blog")
      .replace(/^\/admin(?=\/|$)/, "")
      .split("/")
      .filter(Boolean),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect() {},
  permanentRedirect() {},
}));
vi.mock("@/lib/admin/access", () => ({
  requirePagePermission: async () => ({ user: { id: "admin" } }),
}));
vi.mock("@/lib/blog/queries", () => ({
  listBlogTaxonomy: async () => ({ items: [], nextCursor: null, total: 60, page: 1, pageCount: 3 }),
}));
vi.mock("../app/admin/(protected)/blog/actions", () => ({
  mutateBlogAction: async () => {
    throw new Error("Unexpected mutation");
  },
  readBlogAction: async () => {
    throw new Error("Unexpected query");
  },
}));

const { BlogPosts } = await import("../app/admin/(protected)/blog/components/BlogPosts.tsx");
const { BlogPublishPanel } = await import("../app/admin/(protected)/blog/components/BlogPublishPanel.tsx");
const { filterRelatedTools } = await import("../app/admin/(protected)/blog/components/BlogPostSettings.tsx");
const { historyPageSchema } = await import("../app/admin/(protected)/blog/components/BlogHistoryPanel.tsx");
const { BlogRevisionList } = await import("../app/admin/(protected)/blog/components/BlogRevisionList.tsx");
const taxonomy = await import("../app/admin/(protected)/blog/taxonomy/page.tsx");
const { Pagination } = await import("../components/ui/components/Pagination.tsx");
const { AdminShell } = await import("../app/admin/(protected)/components/AdminShell.tsx");
afterAll(() => {
  delete globalThis.__adminShellPath;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

test("clean admin routes retain the same workspace and navigation as their internal routes", () => {
  try {
    for (const path of [
      "/",
      "/tools",
      "/blog",
      "/blog/post-1",
      "/blog/taxonomy",
      "/templates/new",
      "/templates/post-1/manage",
      "/templates/post-1/advanced",
    ]) {
      const render = (pathname) => {
        globalThis.__adminShellPath = pathname;
        return renderToStaticMarkup(
          createElement(
            NextIntlClientProvider,
            { locale: "en", messages: getCommonMessages("en"), timeZone: "UTC" },
            createElement(AdminShell, {
              user: { name: "Admin", isAdmin: true },
              publicSiteUrl: "https://example.test",
              children: createElement("section", null, "Working document"),
            }),
          ),
        );
      };
      expect(render(path), path).toBe(render(path === "/" ? "/admin" : `/admin${path}`));
    }
  } finally {
    delete globalThis.__adminShellPath;
  }
});

test("history panel accepts paginated revision responses and rejects malformed data", () => {
  const revision = {
    id: "revision-1",
    revisionNumber: 1,
    title: "Saved draft",
    reason: "manual_save",
    createdAt: "2026-09-16T10:00:00Z",
  };
  const page = historyPageSchema.parse({ items: [revision], nextCursor: "older", page: 1, pageCount: 2, total: 26 });
  expect(page.items[0].createdAt.getTime()).toBe(Date.parse(revision.createdAt));
  expect(page.nextCursor).toBe("older");
  expect(historyPageSchema.parse({ items: [], nextCursor: null, page: 1, pageCount: 1, total: 0 })).toEqual({
    items: [],
    nextCursor: null,
    page: 1,
    pageCount: 1,
    total: 0,
  });
  expect(
    historyPageSchema.safeParse({
      items: [{ ...revision, createdAt: "invalid" }],
      nextCursor: null,
    }).success,
  ).toBe(false);
  expect(historyPageSchema.safeParse({ items: [{ id: "category", name: "News" }], nextCursor: null }).success).toBe(
    false,
  );
});

function revisionLinks(props) {
  const html = renderToStaticMarkup(
    createElement(BlogRevisionList, {
      postId: "post-1",
      version: 3,
      publishedRevisionId: null,
      canRestore: false,
      revisions: [
        {
          id: "revision-2",
          revisionNumber: 2,
          title: "Second draft",
          reason: "manual_save",
          createdAt: new Date("2026-09-16T10:00:00Z"),
        },
        {
          id: "revision-1",
          revisionNumber: 1,
          title: "First draft",
          reason: "manual_save",
          createdAt: new Date("2026-09-15T10:00:00Z"),
        },
      ],
      ...props,
    }),
  );
  return Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g), ([, href, content]) => ({
    url: new URL(href.replaceAll("&amp;", "&"), "https://example.test"),
    label: content.replace(/<[^>]+>/g, "").trim(),
  }));
}

test("revision comparison opens and closes without losing pagination; previews retain the selected historical revision", () => {
  const cursor = "older/page?offset=2&filter=saved";
  const links = revisionLinks({
    historyCursor: cursor,
    comparedRevisionId: "revision-2",
    comparison: createElement("p", null, "Changes"),
  });
  const close = links.find((link) => link.label === "Hide details");
  expect(close).toBeTruthy();
  expect(close.url.pathname).toBe("/admin/blog/post-1/history");
  expect([...close.url.searchParams]).toEqual([["cursor", cursor]]);
  const compare = links.find((link) => link.label === "Compare");
  expect(compare.url.pathname).toBe("/admin/blog/post-1/history");
  expect(compare.url.searchParams.get("cursor")).toBe(cursor);
  expect(compare.url.searchParams.get("revision")).toBe("revision-1");
  const previews = links.filter((link) => link.label === "Preview");
  expect(previews.map((link) => link.url.pathname)).toEqual([
    "/admin/blog/post-1/preview",
    "/admin/blog/post-1/preview",
  ]);
  expect(previews.map((link) => [...link.url.searchParams])).toEqual([
    [["revision", "revision-2"]],
    [["revision", "revision-1"]],
  ]);

  const firstPageClose = revisionLinks({
    comparedRevisionId: "revision-2",
    comparison: createElement("p", null, "Changes"),
  }).find((link) => link.label === "Hide details");
  expect(firstPageClose.url.pathname).toBe("/admin/blog/post-1/history");
  expect(firstPageClose.url.search).toBe("");
});

test("compact history and rows without loaded comparison navigate to the revision instead of closing details", () => {
  for (const props of [
    { comparedRevisionId: "revision-2" },
    {
      compact: true,
      comparedRevisionId: "revision-2",
      comparison: createElement("p", null, "Changes"),
    },
  ]) {
    const links = revisionLinks(props);
    expect(links.some((link) => link.label === "Hide details")).toBe(false);
    const comparisons = links.filter((link) => link.label === "Compare");
    expect(comparisons.map((link) => link.url.pathname)).toEqual([
      "/admin/blog/post-1/history",
      "/admin/blog/post-1/history",
    ]);
    expect(comparisons.map((link) => [...link.url.searchParams])).toEqual([
      [["revision", "revision-2"]],
      [["revision", "revision-1"]],
    ]);
  }
});

test("related tool search ignores case and surrounding whitespace without changing the catalog", () => {
  const tools = Object.freeze([
    Object.freeze({ id: "json", name: "JSON Formatter" }),
    Object.freeze({ id: "api", name: "API Key Generator" }),
    Object.freeze({ id: "uuid", name: "UUID Generator" }),
  ]);
  expect(filterRelatedTools(tools, "  gEnErAtOr  ")).toEqual([tools[1], tools[2]]);
  expect(filterRelatedTools(tools, "json")).toEqual([tools[0]]);
  expect(filterRelatedTools(tools, "not a tool")).toEqual([]);
  expect(filterRelatedTools(tools, "")).toEqual(tools);
  expect(filterRelatedTools(tools, "   ")).toEqual(tools);
  expect(filterRelatedTools([], "json")).toEqual([]);
});

test("a published article with a scheduled revision exposes both live and scheduled states", () => {
  const html = renderToStaticMarkup(
    createElement(BlogPosts, {
      posts: [
        {
          id: "post",
          title: "Live article",
          version: 1,
          updatedAt: new Date("2026-09-16T10:00:00Z"),
          publishedRevisionId: "live",
          trashedAt: null,
          hasUnpublishedChanges: true,
          schedule: { scheduledAt: new Date("2026-09-17T10:00:00Z"), lastErrorCode: "RETRY" },
        },
      ],
      categories: { items: [], nextCursor: null },
      filters: {},
      pagination: { page: 1, pageCount: 1, total: 0 },
      canCreate: false,
      canArchive: false,
      canManageTerms: false,
    }),
  );
  expect(html).toMatch(/Update scheduled/);
  expect(html).toMatch(/Current article is live/);
  expect(html).toMatch(/Publishing delayed/);
});

test("taxonomy keeps the originating editor across topic type and pagination changes", async () => {
  const html = renderToStaticMarkup(
    await taxonomy.default({
      searchParams: Promise.resolve({ returnTo: "/admin/blog/post-1", page: "1" }),
    }),
  );
  expect(html).toMatch(/href="\/admin\/blog\/post-1"/);
  expect(html).toMatch(/kind=tag&amp;returnTo=%2Fadmin%2Fblog%2Fpost-1/);
  expect(html).toMatch(/kind=category&amp;returnTo=%2Fadmin%2Fblog%2Fpost-1&amp;page=2/);
});

test("taxonomy rejects external, traversing, and repeated return destinations", async () => {
  for (const returnTo of [
    "https://attacker.invalid",
    "//attacker.invalid",
    "/admin/blog/../../outside",
    ["/admin/blog/post-1"],
  ]) {
    const html = renderToStaticMarkup(await taxonomy.default({ searchParams: Promise.resolve({ returnTo }) }));
    expect(html).not.toMatch(/attacker|outside|returnTo=/);
    expect(html).toMatch(/href="\/admin\/blog"/);
  }
});

test("taxonomy preserves clean admin destinations while rejecting lookalike origins", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://example.test";
  try {
    for (const returnTo of ["/blog/post-1", "/admin/blog/post-1", "https://admin.example.test/blog/post-1"]) {
      const html = renderToStaticMarkup(await taxonomy.default({ searchParams: Promise.resolve({ returnTo }) }));
      expect(html).toMatch(/href="https:\/\/admin\.example\.test\/blog\/post-1"/);
      expect(html).toMatch(/kind=tag&amp;returnTo=https%3A%2F%2Fadmin\.example\.test%2Fblog%2Fpost-1/);
      expect(html).not.toMatch(/href="[^\"]*\/admin\//);
    }
    for (const returnTo of [
      "https://admin.example.test.attacker.invalid/blog/post-1",
      "https://admin.example.test/blog/../outside",
    ]) {
      const html = renderToStaticMarkup(await taxonomy.default({ searchParams: Promise.resolve({ returnTo }) }));
      expect(html).not.toMatch(/attacker|outside|returnTo=/);
      expect(html).toMatch(/href="https:\/\/admin\.example\.test\/blog"/);
    }
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test("publication recovery selects the first failed requirement and blocks publishing", () => {
  const fixed = [];
  const element = BlogPublishPanel({
    mode: "now",
    onModeChange() {},
    schedule: { date: "", time: "09:00", timezone: "UTC" },
    onScheduleChange() {},
    timezones: ["UTC"],
    checks: [
      { id: "title", label: "Article title", valid: true },
      { id: "excerpt", label: "Article excerpt", valid: false },
      { id: "category", label: "Category", valid: false },
    ],
    searchPreview: { title: "Title", description: "", url: "/blog/post" },
    onEditSeo() {},
    onBack() {},
    onSubmit() {
      throw new Error("Invalid publication must not submit");
    },
    onFixCheck: (id) => fixed.push(id),
    canPublish: true,
  });
  function walk(node) {
    return Array.isArray(node)
      ? node.flatMap(walk)
      : node && typeof node === "object" && node.props
        ? [node, ...walk(node.props.children)]
        : [];
  }
  const action = walk(element).find((node) => Array.isArray(node.props.children) && node.props.children[0] === "Fix ");
  action.props.onClick();
  expect(fixed).toEqual(["excerpt"]);
  element.props.onSubmit({ preventDefault() {} });
  expect(renderToStaticMarkup(element)).toMatch(/type="submit"[^>]*disabled=""/);
});

test("numbered pagination keeps first and last jumps and handles both boundaries", () => {
  for (const page of [1, 2, 50, 99, 100]) {
    const html = renderToStaticMarkup(
      createElement(Pagination, {
        page,
        pageCount: 100,
        getPageHref: (target) => `/admin/audit?page=${target}`,
      }),
    );
    expect(html).toMatch(/aria-label="Page 1"[^>]*href="\/admin\/audit\?page=1"/);
    expect(html).toMatch(/aria-label="Page 100"[^>]*href="\/admin\/audit\?page=100"/);
    expect(html).toMatch(new RegExp(`aria-label="Page ${page}" aria-current="page"`));
    if (page === 1) expect(html).toMatch(/aria-label="Previous page"[^>]*disabled/);
    if (page === 100) expect(html).toMatch(/aria-label="Next page"[^>]*disabled/);
  }
  const one = renderToStaticMarkup(createElement(Pagination, { page: 1, pageCount: 1 }));
  expect([...one.matchAll(/aria-label="Page 1"/g)].length).toBe(1);
});
