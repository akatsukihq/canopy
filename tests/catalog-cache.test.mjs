import { toolSpec } from "./helpers/toolSpec.mjs";
import redis from "redis";
import { beforeEach, expect, test, vi } from "vitest";
import { catalogCache } from "@/lib/tool-framework/catalogCache.ts";
const markdownDefinition = await toolSpec("markdown-previewer");
const jsonDefinition = await toolSpec("json-formatter");
import { extractToolMessages, escapeToolText } from "../lib/tool-framework/translations.ts";
import { getPaperworkToolMessages } from "../lib/paperwork/toolMessages.ts";

const state = vi.hoisted(() => ({ configured: true, rows: [], content: [], failure: false, reads: 0, queries: [] }));
vi.mock("@/db/index.ts", async () => {
  const { managedToolsTable, systemLimitsTable, toolContentTable } = await vi.importActual("../db/schema.ts");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const columnKeys = Object.fromEntries(
    Object.entries(managedToolsTable)
      .filter(([, column]) => typeof column?.name === "string")
      .map(([key, column]) => [column.name, key]),
  );
  return {
    managedToolsTable,
    systemLimitsTable,
    toolContentTable,
    isDatabaseConfigured: () => state.configured,
    db: {
      select: (projection) => {
        let predicate;
        let joined = false;
        let source;
        const builder = {
          from: (table) => {
            source = table;
            return builder;
          },
          leftJoin: () => {
            joined = true;
            return builder;
          },
          where: (value) => {
            predicate = value;
            return builder;
          },
          then: (resolve, reject) =>
            Promise.resolve()
              .then(() => {
                // No system limits configured: specs pass through unclamped.
                if (source === systemLimitsTable) return [];
                state.reads++;
                if (state.failure) throw new Error("Database unavailable");
                const query = predicate ? dialect.sqlToQuery(predicate) : null;
                const equalities = query ? [...query.sql.matchAll(/"managed_tools"\."([a-z_]+)" = \$(\d+)/g)] : [];
                const rows = state.rows.filter((value) =>
                  equalities.every(
                    ([, column, index]) => value[columnKeys[column]] === query.params[Number(index) - 1],
                  ),
                );
                const translationProjection = projection?.tool?.translations;
                const projectedLocale = translationProjection?.queryChunks
                  ? dialect.sqlToQuery(translationProjection).params.find((value) => typeof value === "string")
                  : null;
                const result = rows.map((value) => {
                  const translations = projectedLocale
                    ? Object.fromEntries(
                        [...new Set(["en", projectedLocale])].map((locale) => [
                          locale,
                          value.translations[locale] ?? null,
                        ]),
                      )
                    : value.translations;
                  const tool = structuredClone({ ...value, translations });
                  return joined
                    ? {
                        tool,
                        content: structuredClone(
                          state.content.find((content) => content.toolId === value.toolId) ?? null,
                        ),
                      }
                    : tool;
                });
                state.queries.push({
                  toolIds: rows.map((value) => value.toolId),
                  translationLocales: result.map((value) => Object.keys((joined ? value.tool : value).translations)),
                });
                return result;
              })
              .then(resolve, reject),
        };
        return builder;
      },
    },
    getToolContentRows: async () => structuredClone(state.content),
  };
});

beforeEach(() => {
  state.configured = true;
  state.failure = false;
  state.rows = [];
  state.content = [];
  state.reads = 0;
  state.queries = [];
});

function row(app, key, changes = {}) {
  const value = {
    toolId: `${app}.${key}`,
    app,
    slug: key,
    name: key,
    description: "Public tool",
    order: 0,
    enabled: true,
    archived: false,
    icon: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...changes,
  };
  const messages =
    app === "paperwork"
      ? {
          name: escapeToolText(value.name),
          description: escapeToolText(value.description),
          ...getPaperworkToolMessages(key),
        }
      : extractToolMessages({
          ...(key === "json-formatter" ? jsonDefinition : markdownDefinition),
          name: value.name,
          description: value.description,
        });
  const base = key === "json-formatter" ? jsonDefinition : markdownDefinition;
  const spec = app === "paperwork" ? null : { ...base, toolId: value.toolId, app };
  return { spec, ...value, translations: { en: { status: "published", messages } } };
}
const catalog = await import("@/lib/tool-framework/catalog.ts");
const { getTools, getPublicTools, getPaperworkTools, resolveToolPage } = catalog;

test("separately loaded server modules share catalog storage and invalidation", async () => {
  try {
    const { catalogCache: separateModuleCache } = await import("@/lib/tool-framework/catalogCache.ts?separate-bundle");
    const snapshot = { tools: [], paperworkTools: [], publicTools: [] };
    catalogCache.set("all", snapshot);
    expect(separateModuleCache.get("all")).toBe(snapshot);
    separateModuleCache.clear();
    expect(catalogCache.has("all")).toBe(false);
  } finally {
    catalogCache.clear();
  }
});

test.each([undefined])("publication is fresh across independent requests in %s", async (userAgent) => {
  state.configured = true;
  state.failure = false;
  state.content = [];
  state.reads = 0;
  const tool = row("devtools", "markdown-previewer", { name: "Initial name" });
  state.rows = [tool];
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    if (userAgent) Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
    expect((await getTools())[0].name).toBe("Initial name");
    tool.translations.en.messages.name = "Published update";
    expect((await getPublicTools())[0].name).toBe("Published update");
    tool.translations.hi = {
      status: "published",
      messages: { ...tool.translations.en.messages, name: "पूर्वावलोकन" },
    };
    const [english, hindi] = await Promise.all([getTools("devtools", "en"), getTools("devtools", "hi")]);
    expect(english[0].name).toBe("Published update");
    expect(hindi[0].name).toBe("पूर्वावलोकन");
    expect(hindi[0].href).toBe("/hi/devtools/markdown-previewer");
    expect(hindi[0].messages).not.toHaveProperty("en");
    tool.translations.hi.status = "draft";
    expect(await resolveToolPage("devtools", "markdown-previewer", "hi")).toBeNull();
    expect((await getPublicTools("hi"))[0].href).toBe("/devtools/markdown-previewer");
    tool.enabled = false;
    expect(await getPublicTools()).toEqual([]);
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
    else delete globalThis.navigator;
  }
});

test("public reads ignore legacy snapshots and immediately reflect content and translation withdrawals", async () => {
  state.configured = true;
  state.failure = false;
  const tool = row("devtools", "markdown-previewer");
  state.rows = [tool];
  const content = {
    toolId: tool.toolId,
    category: "text-tools",
    keywords: null,
    seoTitle: null,
    seoDescription: null,
    contentDoc: null,
    docVersion: 1,
    publishedAt: new Date(),
    updatedAt: new Date(),
  };
  state.content = [content];
  try {
    const first = await getTools();
    expect(first[0].category).toBe("text-tools");
    catalogCache.set("all", { tools: first, paperworkTools: [], publicTools: [] });
    content.publishedAt = null;
    expect((await getTools())[0].category).toBe(markdownDefinition.category);
    tool.translations.en.status = "draft";
    expect(await getTools()).toEqual([]);
    expect(await resolveToolPage("devtools", "markdown-previewer")).toBeNull();
    tool.translations.en.status = "published";
    expect(await getTools()).toHaveLength(1);
    tool.archived = true;
    expect(await getPublicTools()).toEqual([]);
  } finally {
    catalogCache.clear();
  }
});

test("paperwork discovery keeps locales isolated and restores the English URL when a translation is withdrawn", async () => {
  state.configured = true;
  state.failure = false;
  state.content = [];
  const tool = row("paperwork", "invoice-generator", { name: "Invoice Generator", slug: "custom-invoice" });
  tool.translations.hi = {
    status: "published",
    messages: { ...tool.translations.en.messages, name: "चालान जनरेटर" },
  };
  state.rows = [tool];
  const [english, hindi] = await Promise.all([getPaperworkTools("en"), getPaperworkTools("hi")]);
  expect(english[0].name).toBe("Invoice Generator");
  expect(english[0].href).toBe("/paperwork/custom-invoice");
  expect(hindi[0].name).toBe("चालान जनरेटर");
  expect(hindi[0].href).toBe("/hi/paperwork/custom-invoice");
  expect(hindi[0].availableLocales).toEqual(["en", "hi"]);
  tool.translations.hi.status = "draft";
  const fallback = (await getPublicTools("hi"))[0];
  expect(fallback.name).toBe("Invoice Generator");
  expect(fallback.href).toBe("/paperwork/custom-invoice");
  expect(fallback.locale).toBe("en");
  expect(fallback.availableLocales).toEqual(["en"]);
});

test("discovery uses published DB copy, excludes unavailable tools, and retries database failures", async () => {
  state.configured = true;
  state.failure = false;
  state.content = [];
  state.reads = 0;
  const tool = row("devtools", "markdown-previewer", {
    name: "Preview Markdown",
    icon: {
      v: 1,
      provider: "cloudinary",
      format: "png",
      width: 256,
      height: 256,
      uploadedAt: "2026-01-01T00:00:00Z",
      entry: { cloudName: "c", publicId: "a/b/x", version: 1 },
    },
  });
  const source = {
    ...markdownDefinition,
    name: tool.name,
    description: tool.description,
    keywords: ["published-keyword"],
  };
  tool.translations.en.messages = extractToolMessages(source, { seoTitle: "Published title" });
  state.content = [
    {
      toolId: tool.toolId,
      category: null,
      keywords: ["published-keyword"],
      seoTitle: "Published title",
      seoDescription: null,
      contentDoc: null,
      docVersion: 1,
      publishedAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  state.rows = [
    tool,
    row("paperwork", "invoice-generator", { slug: "custom-invoice" }),
    row("paperwork", "receipt-generator"),
    row("paperwork", "disabled", { enabled: false }),
    row("paperwork", "archived", { archived: true }),
    row("paperwork", "invalid", { slug: "api" }),
    row("devtools", "not-shipped", { spec: null }),
  ];
  const redisSpy = vi.spyOn(redis, "createClient").mockImplementation(() => {
    throw new Error("Public reads must not use Redis");
  });
  try {
    const tools = await getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].keywords).toEqual(["published-keyword"]);
    expect(tools[0].seoTitle).toBe("Published title");
    expect(tools[0].icon).toEqual({
      kind: "url",
      url: "https://res.cloudinary.com/c/image/upload/f_png,c_fill,w_256,h_256,q_auto/v1/a/b/x.png",
      media: tool.icon,
    });
    const paperwork = await getPaperworkTools();
    expect(paperwork.map((item) => item.componentKey)).toEqual(["invoice-generator", "receipt-generator"]);
    expect((await getPublicTools()).map((item) => item.href)).toContain("/paperwork/custom-invoice");
    expect(await getPublicTools()).toHaveLength(3);
    state.failure = true;
    await expect(getPublicTools()).rejects.toThrow("Database unavailable");
    state.failure = false;
    expect(await getPublicTools()).toHaveLength(3);
    state.configured = false;
    expect(await getPublicTools()).toEqual([]);
    state.configured = true;
    expect(await getPublicTools()).toHaveLength(3);
    expect(redisSpy).not.toHaveBeenCalled();
  } finally {
    redisSpy.mockRestore();
  }
});

test("app listings read only available rows in their app and request English plus the selected language", async () => {
  const tool = row("devtools", "markdown-previewer", { slug: "published-preview" });
  tool.translations.hi = {
    status: "published",
    messages: { ...tool.translations.en.messages, name: "पूर्वावलोकन" },
  };
  Object.defineProperty(tool.translations, "fr", {
    enumerable: true,
    get() {
      throw new Error("An unrelated language was loaded.");
    },
  });
  state.rows = [
    tool,
    row("paperwork", "invoice-generator"),
    row("media", "other-app"),
    row("devtools", "disabled", { enabled: false }),
    row("devtools", "archived", { archived: true }),
  ];
  const listings = await catalog.getToolListings("devtools", "hi");
  expect(listings.map((value) => ({ name: value.name, href: value.href }))).toEqual([
    { name: "पूर्वावलोकन", href: "/hi/devtools/published-preview" },
  ]);
  expect(state.queries.at(-1)).toEqual({
    toolIds: [tool.toolId],
    translationLocales: [["en", "hi"]],
  });
  expect((await catalog.getPublicToolListings("hi", "devtools")).map((value) => value.toolId)).toEqual([tool.toolId]);
  expect(state.queries.at(-1)).toEqual({
    toolIds: [tool.toolId],
    translationLocales: [["en", "hi"]],
  });
});

test("public discovery lists all app types while transferring only requested locale records", async () => {
  const developer = row("devtools", "markdown-previewer");
  const paperwork = row("paperwork", "invoice-generator", { slug: "custom-invoice" });
  for (const tool of [developer, paperwork]) {
    tool.translations.hi = { status: "published", messages: { ...tool.translations.en.messages, name: "हिन्दी नाम" } };
    tool.translations.fr = {
      status: "published",
      messages: { ...tool.translations.en.messages, name: "Nom français" },
    };
  }
  state.rows = [developer, paperwork];
  expect((await catalog.getPublicToolListings("hi")).map((value) => value.href)).toEqual([
    "/hi/devtools/markdown-previewer",
    "/hi/paperwork/custom-invoice",
  ]);
  expect(state.queries.flatMap((query) => query.toolIds)).toEqual([developer.toolId, paperwork.toolId]);
  expect(state.queries.flatMap((query) => query.translationLocales)).toEqual([
    ["en", "hi"],
    ["en", "hi"],
  ]);
  expect((await catalog.getPublicToolListings("en", "paperwork"))[0].href).toBe("/paperwork/custom-invoice");
  expect(state.queries.at(-1)).toEqual({ toolIds: [paperwork.toolId], translationLocales: [["en"]] });
});

test("listings ignore non-card runtime validation while keeping malformed visible text safe", async () => {
  const tool = row("devtools", "markdown-previewer");
  tool.translations.hi = {
    status: "published",
    messages: { ...tool.translations.en.messages, name: "पूर्वावलोकन", "runtime.malformed": "{broken" },
  };
  state.rows = [tool];
  expect((await catalog.getToolListings("devtools", "hi"))[0].name).toBe("पूर्वावलोकन");
  expect(await resolveToolPage("devtools", "markdown-previewer", "hi")).toBeNull();
  tool.translations.hi.messages.name = "{broken";
  const fallback = (await catalog.getToolListings("devtools", "hi"))[0];
  expect(fallback.name).toBe(tool.name);
  expect(fallback.href).toBe("/devtools/markdown-previewer");
  expect(fallback.locale).toBe("en");
  tool.translations.en.messages.name = "{broken";
  expect(await catalog.getToolListings("devtools", "hi")).toEqual([]);
  tool.translations.en.messages.name = tool.name;
  tool.translations.en.status = "draft";
  expect(await catalog.getToolListings("devtools", "hi")).toEqual([]);
});

test("listing publication and withdrawals are fresh without catalog snapshots", async () => {
  const tool = row("devtools", "markdown-previewer");
  tool.translations.hi = { status: "published", messages: { ...tool.translations.en.messages, name: "पहला नाम" } };
  state.rows = [tool];
  expect((await catalog.getToolListings("devtools", "hi"))[0].name).toBe("पहला नाम");
  tool.translations.hi.messages.name = "प्रकाशित बदलाव";
  expect((await catalog.getToolListings("devtools", "hi"))[0].name).toBe("प्रकाशित बदलाव");
  tool.translations.hi.status = "draft";
  expect((await catalog.getToolListings("devtools", "hi"))[0].href).toBe("/devtools/markdown-previewer");
  tool.enabled = false;
  expect(await catalog.getToolListings("devtools", "hi")).toEqual([]);
  tool.enabled = true;
  tool.archived = true;
  expect(await catalog.getPublicToolListings("hi", "devtools")).toEqual([]);
});

test("published content contract changes leave listings visible and are validated on the exact detail page", async () => {
  const tool = row("devtools", "markdown-previewer");
  const content = {
    toolId: tool.toolId,
    category: "text-tools",
    keywords: null,
    seoTitle: null,
    seoDescription: null,
    contentDoc: { version: 1, howToUse: ["One published instruction"] },
    docVersion: 1,
    publishedAt: new Date(),
    updatedAt: new Date(),
  };
  state.rows = [tool];
  state.content = [content];
  const listing = (await catalog.getToolListings("devtools", "en"))[0];
  expect(listing.name).toBe(tool.name);
  expect(listing.category).toBe("text-tools");
  expect(await resolveToolPage("devtools", "markdown-previewer", "en")).toBeNull();
  tool.translations.en.messages = extractToolMessages({
    ...markdownDefinition,
    name: "Published copy update",
    description: tool.description,
    content: { howToUse: content.contentDoc.howToUse },
  });
  expect((await catalog.getToolListings("devtools", "en"))[0].name).toBe("Published copy update");
  expect((await resolveToolPage("devtools", "markdown-previewer", "en")).content.howToUse).toEqual([
    "One published instruction",
  ]);
  content.publishedAt = null;
  expect((await catalog.getToolListings("devtools", "en"))[0].category).toBe(markdownDefinition.category);
  expect(await resolveToolPage("devtools", "markdown-previewer", "en")).toBeNull();
});

test("detail resolution reads its custom slug only and retains complete valid locale alternates", async () => {
  const target = row("devtools", "markdown-previewer", { slug: "custom-preview" });
  target.translations.hi = {
    status: "published",
    messages: { ...target.translations.en.messages, name: "पूर्वावलोकन" },
  };
  target.translations.fr = { status: "published", messages: { ...target.translations.en.messages, name: "Aperçu" } };
  state.rows = [
    target,
    row("devtools", "json-formatter"),
    row("paperwork", "invoice-generator"),
    row("media", "markdown-previewer", { slug: "custom-preview" }),
  ];
  const detail = await resolveToolPage("devtools", "custom-preview", "hi");
  expect(detail.definitionKey).toBe("markdown-previewer");
  expect(detail.href).toBe("/hi/devtools/custom-preview");
  expect(detail.availableLocales).toEqual(["en", "hi", "fr"]);
  expect(state.queries.at(-1)).toEqual({
    toolIds: [target.toolId],
    translationLocales: [["en", "hi", "fr"]],
  });
  expect(await resolveToolPage("devtools", "markdown-previewer", "hi")).toBeNull();
});

test("ambiguous exact slugs resolve to no tool", async () => {
  const first = row("devtools", "markdown-previewer", { slug: "duplicate-slug" });
  const second = row("devtools", "json-formatter", { slug: "duplicate-slug" });
  state.rows = [first, second, row("paperwork", "invoice-generator")];
  expect(await resolveToolPage("devtools", "duplicate-slug", "en")).toBeNull();
  expect(state.queries.at(-1).toolIds).toEqual([first.toolId, second.toolId]);
});

test("full public discovery retains every valid published locale for sitemap coverage", async () => {
  const developer = row("devtools", "markdown-previewer");
  const paperwork = row("paperwork", "invoice-generator");
  for (const tool of [developer, paperwork]) {
    tool.translations.hi = { status: "published", messages: { ...tool.translations.en.messages, name: "हिन्दी नाम" } };
    tool.translations.fr = { status: "draft", messages: { ...tool.translations.en.messages, name: "Nom français" } };
    tool.translations.de = { status: "published", messages: { ...tool.translations.en.messages, name: "Werkzeug" } };
  }
  state.rows = [developer, paperwork];
  expect((await getPublicTools("hi")).map((value) => value.availableLocales)).toEqual([
    ["en", "hi", "de"],
    ["en", "hi", "de"],
  ]);
});

test("related tools prioritize curated cards, then unique category matches, without validating neighbor runtimes", async () => {
  const [whitespaceDefinition, duplicateDefinition, sorterDefinition] = await Promise.all([
    toolSpec("whitespace-remover"),
    toolSpec("duplicate-line-remover"),
    toolSpec("text-sorter"),
  ]);
  const target = row("devtools", "markdown-previewer");
  const curated = row("devtools", "json-formatter", { order: 99 });
  const neighbors = [whitespaceDefinition, duplicateDefinition, sorterDefinition].map((definition, index) => {
    const tool = row("devtools", definition.toolId.split(".")[1], { order: index + 1, spec: definition });
    tool.translations.en.messages = extractToolMessages({
      ...definition,
      name: tool.name,
      description: tool.description,
    });
    return tool;
  });
  const [whitespace, duplicate] = neighbors;
  curated.translations.en.messages["runtime.unrelated"] = "{broken";
  curated.translations.hi = { status: "draft", messages: curated.translations.en.messages };
  whitespace.translations.hi = {
    status: "published",
    messages: { ...whitespace.translations.en.messages, name: "हिन्दी पड़ोसी", "runtime.unrelated": "{broken" },
  };
  state.rows = [target, curated, ...neighbors];
  state.content = [
    {
      toolId: target.toolId,
      category: "text-tools",
      keywords: null,
      seoTitle: null,
      seoDescription: null,
      contentDoc: {
        version: 1,
        ...markdownDefinition.content,
        relatedToolIds: [target.toolId, curated.toolId, whitespace.toolId],
      },
      docVersion: 1,
      publishedAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const related = await catalog.relatedTools(target.toolId, "hi");
  expect(related.map((tool) => tool.toolId)).toEqual([curated.toolId, whitespace.toolId, duplicate.toolId]);
  expect(new Set(related.map((tool) => tool.toolId)).size).toBe(3);
  expect(related.map((tool) => tool.locale)).toEqual(["en", "hi", "en"]);
  expect(related[0].href).toBe("/devtools/json-formatter");
  expect(related[1].name).toBe("हिन्दी पड़ोसी");
  expect(related[1].href).toBe("/hi/devtools/whitespace-remover");
  for (const tool of related) {
    expect(tool).not.toHaveProperty("messages");
    expect(tool).not.toHaveProperty("spec");
    expect(tool).not.toHaveProperty("availableLocales");
  }
});
