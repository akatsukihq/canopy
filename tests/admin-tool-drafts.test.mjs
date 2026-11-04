import { expect, onTestFinished, test, vi } from "vitest";

const fixture = { configured: true, rows: [], content: [], queries: 0 };
globalThis.__canopyDraftTest = fixture;

vi.mock("@/db/index.ts", () => ({
  managedToolsTable: {},
  isDatabaseConfigured: () => globalThis.__canopyDraftTest.configured,
  db: {
    select() {
      return {
        async from() {
          globalThis.__canopyDraftTest.queries++;
          return globalThis.__canopyDraftTest.rows;
        },
      };
    },
  },
  async getToolContentRows() {
    globalThis.__canopyDraftTest.queries++;
    return globalThis.__canopyDraftTest.content;
  },
}));
vi.mock("@/lib/tool-framework/catalog.ts", () => ({
  definitionKeyOf: (id) => id.split(".")[1],
  specFromRow: async () => null,
}));

const { getAdminTools } = await import("@/lib/tool-framework/manifest.ts");

test("admin drafts match unpublished content by tool ID and require a configured database", async () => {
  onTestFinished(() => {
    delete globalThis.__canopyDraftTest;
  });
  const cases = [
    ["seed", {}, false],
    ["category", { category: "json-tools" }, true],
    ["title", { seoTitle: "Draft title" }, true],
    ["description", { seoDescription: "Draft description" }, true],
    ["keywords", { keywords: ["draft"] }, true],
    ["document", { contentDoc: { version: 1, howToUse: ["Upload a file"] } }, true],
    ["published", { seoTitle: "Published title", publishedAt: new Date() }, false],
    ["cleared", { category: " ", seoTitle: "", seoDescription: "\t", keywords: [] }, false],
    ["blank-keywords", { keywords: ["", " "] }, false],
    ["missing", null, false],
  ];
  fixture.rows = cases.map(([name], order) => ({
    toolId: `paperwork.${name}`,
    app: "paperwork",
    slug: name,
    name,
    description: name,
    order,
    enabled: true,
    archived: false,
  }));
  fixture.content = cases
    .filter(([, content]) => content !== null)
    .map(([name, content]) => ({
      toolId: `paperwork.${name}`,
      category: null,
      keywords: null,
      seoTitle: null,
      seoDescription: null,
      contentDoc: null,
      docVersion: 1,
      publishedAt: null,
      updatedAt: new Date(),
      ...content,
    }));
  fixture.content.unshift({
    toolId: "media.missing",
    seoTitle: "Another tool's draft",
    publishedAt: null,
  });
  expect((await getAdminTools()).map(({ id, hasDraftContent }) => [id, hasDraftContent])).toEqual(
    cases.map(([name, , expected]) => [`paperwork.${name}`, expected]),
  );

  fixture.configured = false;
  const queries = fixture.queries;
  expect(await getAdminTools()).toEqual([]);
  expect(fixture.queries, "unconfigured database is never queried").toBe(queries);
});
