import { expect, test } from "vitest";

import {
  areToolSlugsUnique,
  assertToolSlugImmutable,
  findAvailableToolBySlug,
  getEnabledTools,
  isToolAvailable,
  isValidToolSlug,
  mergeManagedTool,
  mergeToolManifest,
  reservedToolSlugs,
  slugFromName,
} from "../lib/tool-catalog/index.ts";

// The package holds no inventory, so these tests supply their own manifest.
// That is the point: the merge is pure, and its semantics must hold for any
// manifest, not for one particular list of shipped tools. Every expectation
// below is derived from this fixture, never from a literal count.
const MANIFEST = [
  {
    id: "paperwork.alpha",
    app: "paperwork",
    componentKey: "alpha",
    defaultName: "Alpha",
    defaultDescription: "The first.",
  },
  {
    id: "paperwork.beta",
    app: "paperwork",
    componentKey: "beta",
    defaultName: "Beta",
    defaultDescription: "The second.",
  },
  {
    id: "devtools.gamma",
    app: "devtools",
    category: "Fixtures",
    componentKey: "gamma",
    defaultName: "Gamma",
    defaultDescription: "The third.",
  },
  {
    id: "media.delta",
    app: "media",
    category: "Fixtures",
    componentKey: "delta",
    defaultName: "Delta",
    defaultDescription: "The fourth.",
  },
];

const manifestFor = (app) => MANIFEST.filter((entry) => entry.app === app);
const paperwork = manifestFor("paperwork");
const [firstPaperwork, secondPaperwork] = paperwork;
const firstDevtool = manifestFor("devtools")[0];

// An arbitrary order value that cannot collide with a merged order.
const STORED_ORDER = MANIFEST.length;

/** A stored row that keeps a tool exactly as its manifest entry describes it. */
function row(entry, changes = {}) {
  return {
    toolId: entry.id,
    slug: entry.componentKey,
    name: entry.defaultName,
    description: entry.defaultDescription,
    order: MANIFEST.filter((other) => other.app === entry.app).indexOf(entry),
    enabled: true,
    archived: false,
    ...changes,
  };
}

/** Every tool configured and live, which is what most assertions start from. */
const configured = () =>
  mergeToolManifest(
    MANIFEST.map((entry) => row(entry)),
    MANIFEST,
  );

function merge(...storedRows) {
  return mergeToolManifest(storedRows, MANIFEST);
}

function resolve(storedRow) {
  return merge(storedRow).find((tool) => tool.id === storedRow.toolId);
}

test("the manifest is the map: one resolved tool per entry, in manifest order", () => {
  const tools = merge();

  expect(tools.map((tool) => tool.id)).toEqual(MANIFEST.map((entry) => entry.id));
  expect(tools.length).toBe(MANIFEST.length);
});

test("stored rows override the seeded name, description, order, and enabled flag", () => {
  const tool = resolve({
    toolId: firstPaperwork.id,
    slug: firstPaperwork.componentKey,
    name: "Configured Name",
    description: "Configured externally.",
    order: STORED_ORDER,
    enabled: true,
    archived: false,
  });

  expect(tool?.name).toBe("Configured Name");
  expect(tool?.description).toBe("Configured externally.");
  expect(tool?.order).toBe(STORED_ORDER);
  expect(tool?.enabled).toBe(true);
});

test("merging keeps every code registration and drops unknown stored tool ids", () => {
  const tools = merge(
    {
      toolId: secondPaperwork.id,
      slug: "receipts",
      name: "Receipt Maker",
      description: "Create a receipt.",
      order: STORED_ORDER,
      enabled: false,
      archived: true,
    },
    {
      toolId: "removed.unknown-tool",
      slug: "removed",
      name: "Removed",
      description: "No longer registered.",
      order: STORED_ORDER,
      enabled: true,
      archived: false,
    },
  );

  expect(tools.length).toBe(MANIFEST.length);
  expect(tools.find((tool) => tool.id === secondPaperwork.id)).toEqual({
    ...secondPaperwork,
    icon: null,
    toolId: secondPaperwork.id,
    slug: "receipts",
    name: "Receipt Maker",
    description: "Create a receipt.",
    order: STORED_ORDER,
    enabled: false,
    archived: true,
  });
  expect(
    tools.some((tool) => tool.id === "removed.unknown-tool"),
    "a stored row named by no manifest entry is dropped, silently",
  ).toBe(false);
});

test("blank stored strings and non-integer orders fall back to the manifest", () => {
  const tool = resolve({
    toolId: firstPaperwork.id,
    slug: firstPaperwork.componentKey,
    name: "   ",
    description: "",
    order: "not-an-integer",
    enabled: true,
    archived: false,
  });

  expect(tool?.name).toBe(firstPaperwork.defaultName);
  expect(tool?.description).toBe(firstPaperwork.defaultDescription);
  expect(tool?.order).toBe(paperwork.indexOf(firstPaperwork));
});

test("invalid persisted slugs fail closed while valid fields still merge", () => {
  const tool = resolve({
    toolId: secondPaperwork.id,
    slug: "Receipt--Generator",
    name: "Receipt Maker",
    description: "Create a receipt.",
    order: STORED_ORDER,
    enabled: true,
    archived: false,
  });

  expect(tool?.slug).toBe(null);
  expect(tool?.enabled, "a routeless tool can never be enabled").toBe(false);
  expect(tool?.name).toBe("Receipt Maker");
});

test("a cleared slug returns the tool to setup-required and disabled", () => {
  const tool = resolve(row(firstPaperwork, { slug: null, order: STORED_ORDER }));

  expect(tool?.slug).toBe(null);
  expect(tool?.enabled).toBe(false);
  expect(isToolAvailable(tool)).toBe(false);
});

test("an archived tool stops being available even while enabled", () => {
  const tool = resolve(row(firstPaperwork, { archived: true }));

  expect(tool?.archived).toBe(true);
  expect(isToolAvailable(tool)).toBe(false);
});

test("an unconfigured tool is setup-required and disabled by default", () => {
  // No stored row at all: the merge must not invent a route from the component
  // key, which is what would silently publish a tool nobody configured.
  expect(merge()).toEqual([
    ...MANIFEST.map((entry) => ({
      ...entry,
      icon: null,
      toolId: entry.id,
      slug: null,
      name: entry.defaultName,
      description: entry.defaultDescription,
      order: manifestFor(entry.app).indexOf(entry),
      enabled: false,
      archived: false,
    })),
  ]);
});

test("mergeManagedTool falls back wholesale when the stored value is not a row", () => {
  const fallback = {
    toolId: firstPaperwork.id,
    slug: null,
    name: firstPaperwork.defaultName,
    description: firstPaperwork.defaultDescription,
    order: 0,
    enabled: false,
    archived: false,
  };

  for (const stored of [undefined, null, "row", 7, [{ slug: "alpha" }]]) {
    expect(mergeManagedTool(firstPaperwork, fallback, stored)).toEqual(fallback);
  }
});

test("tool slugs use lowercase segments and reject reserved application routes", () => {
  for (const slug of ["invoice", "invoice-2", "2fa-tool", "w9-request"]) {
    expect(isValidToolSlug("paperwork", slug), slug).toBe(true);
  }

  for (const slug of [
    "",
    "Invoice",
    "invoice_generator",
    "invoice--generator",
    "-invoice",
    "invoice-",
    "/invoice",
    null,
    undefined,
  ]) {
    expect(isValidToolSlug("paperwork", slug), String(slug)).toBe(false);
  }

  for (const [app, reserved] of Object.entries(reservedToolSlugs)) {
    for (const slug of reserved) {
      expect(isValidToolSlug(app, slug), `${app}:${slug}`).toBe(false);
    }
  }
  expect(isValidToolSlug(firstDevtool.app, firstDevtool.componentKey)).toBe(true);
});

test("slugFromName produces a valid slug or refuses", () => {
  expect(slugFromName("Receipt & Invoice Maker")).toBe("receipt-and-invoice-maker");
  expect(isValidToolSlug("devtools", slugFromName("JSON  Formatter!"))).toBe(true);
  expect(() => slugFromName("---")).toThrow(/at least one letter or number/i);
});

test("tool slugs are unique within an application but may repeat across applications", () => {
  const tools = configured();
  const takenSlug = firstPaperwork.componentKey;
  const withSlug = (id, slug) => tools.map((tool) => (tool.id === id ? { ...tool, slug } : tool));

  expect(areToolSlugsUnique(tools, MANIFEST)).toBe(true);
  expect(areToolSlugsUnique(withSlug(secondPaperwork.id, takenSlug), MANIFEST)).toBe(false);
  expect(areToolSlugsUnique(withSlug(firstDevtool.id, takenSlug), MANIFEST)).toBe(true);
  expect(areToolSlugsUnique(withSlug(secondPaperwork.id, null), MANIFEST)).toBe(true);
  expect(
    areToolSlugsUnique([{ ...tools[0], toolId: "removed.unknown-tool" }], MANIFEST),
    "a slug held by no manifest entry cannot be proven unique",
  ).toBe(false);
});

test("a saved slug is immutable while setup-required tools may receive their first slug", () => {
  expect(() => assertToolSlugImmutable(null, "proposal-builder")).not.toThrow();
  expect(() => assertToolSlugImmutable("invoice-generator", "invoice-generator")).not.toThrow();
  expect(() => assertToolSlugImmutable("invoice-generator", "invoices")).toThrow(/immutable/i);
  expect(() => assertToolSlugImmutable("invoice-generator", null)).toThrow(/immutable/i);
});

test("disabled, archived, setup-required, and ambiguous tools are blocked", () => {
  const tools = configured();
  const slug = firstPaperwork.componentKey;
  const patch = (id, changes) => tools.map((tool) => (tool.id === id ? { ...tool, ...changes } : tool));

  const enabledPaperwork = getEnabledTools(tools, "paperwork");
  const disabled = patch(firstPaperwork.id, { enabled: false });
  const archived = patch(firstPaperwork.id, { archived: true });
  const setupRequired = patch(firstPaperwork.id, { slug: null });
  const duplicateRoute = patch(secondPaperwork.id, { slug });

  expect(isToolAvailable(tools[0])).toBe(true);
  expect(
    getEnabledTools(disabled, "paperwork").map((tool) => tool.id),
    "disabling one tool removes exactly that tool, in stored order",
  ).toEqual(enabledPaperwork.filter((tool) => tool.id !== firstPaperwork.id).map((tool) => tool.id));
  expect(
    enabledPaperwork.map((tool) => tool.order),
    "enabled tools come back sorted by stored order",
  ).toEqual([...enabledPaperwork.map((tool) => tool.order)].sort((a, b) => a - b));
  expect(
    getEnabledTools(tools)
      .map((tool) => tool.id)
      .sort(),
    "an omitted app returns every available tool",
  ).toEqual(MANIFEST.map((entry) => entry.id).sort());

  for (const [label, candidates] of [
    ["disabled", disabled],
    ["archived", archived],
    ["setup-required", setupRequired],
    ["ambiguous", duplicateRoute],
  ]) {
    expect(findAvailableToolBySlug(candidates, "paperwork", slug), `${label} tools must not resolve a route`).toBe(
      undefined,
    );
  }

  expect(findAvailableToolBySlug(tools, "paperwork", slug)?.id).toBe(firstPaperwork.id);
  for (const reserved of reservedToolSlugs.paperwork) {
    expect(findAvailableToolBySlug(tools, "paperwork", reserved)).toBe(undefined);
  }
});

test("stored tool icons pass through catalog resolution and missing icons stay null", () => {
  const icon = { v: 1, provider: "cloudinary", format: "png", width: 256, height: 256, uploadedAt: "2026-01-01T00:00:00Z", entry: { cloudName: "c", publicId: "a/b/x", version: 1 } };
  expect(resolve(row(firstPaperwork, { icon })).icon).toEqual(icon);
  for (const missing of [null, undefined]) expect(resolve(row(firstPaperwork, { icon: missing })).icon).toBe(null);
});
