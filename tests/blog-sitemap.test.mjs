import { afterAll, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ tools: [], posts: [], toolsError: false, postsError: false, limits: [] }));
globalThis.__blogSitemapTest = state;

vi.mock("@/lib/tool-framework/catalog", () => ({
  getSitemapTools: async () => {
    if (state.toolsError) throw new Error("Tool catalog unavailable");
    return state.tools;
  },
}));
vi.mock("@/lib/blog/queries", () => ({
  getBlogSitemapEntries: async (limit) => {
    state.limits.push(limit);
    if (state.postsError) throw new Error("Blog catalog unavailable");
    return state.posts.slice(0, limit);
  },
}));

const { default: sitemap } = await import("@/app/sitemap.ts");
const { locales } = await import("@/lib/i18n/config.ts");
// Home, three suite hubs, two paperwork pages, privacy and contact in every locale, plus the blog index.
const PAGE_COUNT = 8 * locales.length + 1;
const originalUrl = process.env.APP_URL;
beforeEach(() => {
  Object.assign(state, { tools: [], posts: [], toolsError: false, postsError: false, limits: [] });
  process.env.APP_URL = "https://smarttools.example";
});
afterAll(() => {
  if (originalUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalUrl;
  delete globalThis.__blogSitemapTest;
});

test("sitemap lists localized home, hub and static pages with hreflang alternates", async () => {
  const entries = await sitemap();
  expect(entries.length).toBe(PAGE_COUNT);
  const urls = entries.map((entry) => entry.url);
  for (const url of [
    "https://smarttools.example/",
    "https://smarttools.example/ja",
    "https://smarttools.example/devtools",
    "https://smarttools.example/de/media",
    "https://smarttools.example/fr/paperwork/about",
    "https://smarttools.example/privacy",
    "https://smarttools.example/blog",
  ]) {
    expect(urls).toContain(url);
  }
  const devtools = entries.find((entry) => entry.url === "https://smarttools.example/es/devtools");
  expect(devtools.alternates.languages).toMatchObject({
    en: "https://smarttools.example/devtools",
    es: "https://smarttools.example/es/devtools",
    "zh-Hans": "https://smarttools.example/zh-Hans/devtools",
  });
});

test("sitemap preserves tool entries and adds blog publication timestamps and canonical URLs", async () => {
  const publishedUpdatedAt = new Date("2026-09-16T10:00:00Z");
  state.tools = [
    { href: "/devtools/json-formatter", availableLocales: ["en", "ja"] },
    { href: "/paperwork/invoice-generator", availableLocales: ["en"] },
  ];
  state.posts = [{ slug: "using-json", publishedUpdatedAt }];
  expect((await sitemap()).slice(PAGE_COUNT)).toEqual([
    {
      url: "https://smarttools.example/devtools/json-formatter",
      alternates: {
        languages: {
          en: "https://smarttools.example/devtools/json-formatter",
          ja: "https://smarttools.example/ja/devtools/json-formatter",
        },
      },
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://smarttools.example/ja/devtools/json-formatter",
      alternates: {
        languages: {
          en: "https://smarttools.example/devtools/json-formatter",
          ja: "https://smarttools.example/ja/devtools/json-formatter",
        },
      },
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://smarttools.example/paperwork/invoice-generator",
      alternates: { languages: { en: "https://smarttools.example/paperwork/invoice-generator" } },
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: "https://smarttools.example/blog/using-json",
      lastModified: publishedUpdatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ]);
});

test("either catalog can fail independently without losing the other catalog's URLs", async () => {
  state.tools = [{ href: "/media/image-converter", availableLocales: ["en"] }];
  state.posts = [{ slug: "images", publishedUpdatedAt: new Date("2026-09-16T10:00:00Z") }];
  state.postsError = true;
  const urls = async () => (await sitemap()).slice(PAGE_COUNT).map((entry) => entry.url);
  expect(await urls()).toEqual(["https://smarttools.example/media/image-converter"]);
  state.postsError = false;
  state.toolsError = true;
  expect(await urls()).toEqual(["https://smarttools.example/blog/images"]);
  state.postsError = true;
  expect(await sitemap()).toHaveLength(PAGE_COUNT);
});

test("sitemap bounds the combined catalog to 50,000 URLs and keeps tool URLs ahead of blog entries", async () => {
  state.tools = Array.from({ length: 50000 - PAGE_COUNT - 1 }, (_, index) => ({
    href: `/devtools/tool-${index}`,
    availableLocales: ["en"],
  }));
  state.posts = [
    { slug: "first", publishedUpdatedAt: new Date() },
    { slug: "second", publishedUpdatedAt: new Date() },
  ];
  const entries = await sitemap();
  expect(entries.length).toBe(50000);
  expect(entries.at(-1).url).toBe("https://smarttools.example/blog/first");
  state.tools.push({ href: "/devtools/extra-a", availableLocales: ["en"] });
  state.tools.push({ href: "/devtools/extra-b", availableLocales: ["en"] });
  const capped = await sitemap();
  expect(capped.length).toBe(50000);
  expect(capped.at(-1).url).toBe("https://smarttools.example/devtools/extra-a");
});

test("sitemap retains the local APP_URL fallback", async () => {
  delete process.env.APP_URL;
  expect((await sitemap())[0].url).toBe("http://localhost:3000/");
});

test("sitemap query rejects unbounded limits and returns zero capacity without database work", async () => {
  const { getBlogSitemapEntries } = await vi.importActual("@/lib/blog/queries");
  expect(await getBlogSitemapEntries(0)).toEqual([]);
  for (const value of [-1, 50001, 1.5, Infinity, NaN, "10", null]) {
    await expect(getBlogSitemapEntries(value)).rejects.toThrow();
  }
}, 45000); // importActual loads the real query/db layer, which is slow to initialize under parallel load
