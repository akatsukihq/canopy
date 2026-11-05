import { afterEach, expect, test, vi } from "vitest";
import { ADMIN_ACCESS } from "../lib/authorization/index.ts";
import { auditEventsTable, db, managedToolsTable, toolContentTable } from "../db/index.ts";
import { reservedToolSlugs } from "../lib/tool-catalog/index.ts";
import { createManagedTool, ToolSpecValidationError } from "../lib/admin/adminMutations.ts";
import { TOOL_CATEGORIES } from "../lib/tool-framework/categories.ts";
import { toolSpec } from "./helpers/toolSpec.mjs";

const limits = vi.hoisted(() => ({ violations: [] }));
afterEach(() => {
  limits.violations = [];
});

vi.mock("@/lib/tool-framework/systemLimits.ts", () => ({
  loadSystemLimits: async () => ({}),
  limitViolations: () => limits.violations,
}));

const APP = "devtools";
// Resolved from the registry: no category or tool is named here.
const CATEGORY = Object.keys(TOOL_CATEGORIES).find((key) => TOOL_CATEGORIES[key].app === APP);
const OTHER_APP_CATEGORY = Object.keys(TOOL_CATEGORIES).find((key) => TOOL_CATEGORIES[key].app !== APP);
const RESERVED_SLUG = reservedToolSlugs[APP][0];

const KEY = "aardvark-widget";
const DRAFT = {
  app: APP,
  key: KEY,
  name: "Aardvark Widget",
  description: "Does an aardvark-shaped thing.",
  slug: "",
  category: CATEGORY,
};

// -- the fake transaction, matching tests/admin-tool-content.test.mjs --------

function permissionRows(access) {
  return [
    {
      status: "active",
      roleId: "test-role",
      roleName: "Test role",
      roleDescription: "Test permissions.",
      roleAccess: { ...access, admin: { enter: true, ...access.admin } },
      roleIsSystem: false,
    },
  ];
}

function createFakeTransaction(selectResults) {
  const state = { inserts: [], updates: [], deletes: [] };

  function select() {
    const result = selectResults.shift();
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve, reject) =>
        result === undefined
          ? Promise.reject(new Error("Unexpected database read")).then(resolve, reject)
          : Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  function mutationChain(entry, values) {
    const rows = Array.isArray(values) ? values : [values];
    const chain = {
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: (config) => {
        entry.set = config?.set;
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return chain;
  }

  function mutation(kind, table, values) {
    const entry = { table, values };
    state[kind].push(entry);
    const rows = Array.isArray(values) ? values : [values];
    const chain = {
      values(nextValues) {
        entry.values = nextValues;
        return mutationChain(entry, nextValues);
      },
      set(nextValues) {
        entry.values = nextValues;
        return mutationChain(entry, nextValues);
      },
      where: () => chain,
      returning: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return chain;
  }

  return {
    state,
    transaction: {
      select,
      insert: (table) => mutation("inserts", table),
      update: (table) => mutation("updates", table),
      delete: (table) => mutation("deletes", table),
    },
  };
}

async function withFakeDatabase(selectResults, callback) {
  const originalTransaction = db.transaction;
  const fake = createFakeTransaction([...selectResults]);
  db.transaction = async (operation) => operation(fake.transaction);
  try {
    return await callback(fake.state);
  } finally {
    db.transaction = originalTransaction;
  }
}

function accessWithout(resource, action) {
  const access = structuredClone(ADMIN_ACCESS);
  delete access[resource][action];
  return access;
}

const EDITOR = permissionRows({ tools: { view: true, edit: true } });

function toolWrite(state) {
  return state.inserts.find(({ table }) => table === managedToolsTable);
}

function contentWrite(state) {
  return state.inserts.find(({ table }) => table === toolContentTable);
}

function auditWrite(state) {
  return state.inserts.find(({ table }) => table === auditEventsTable);
}

/** Existing rows for the app, shaped like the one locked read the write does. */
function siblings(...rows) {
  return rows;
}

// -- authorization ----------------------------------------------------------

test("creating a tool requires tools.edit and writes nothing without it", async () => {
  await withFakeDatabase([permissionRows(accessWithout("tools", "edit"))], async (state) => {
    await expect(() => createManagedTool("actor", DRAFT)).rejects.toThrow(/Missing permission: tools\.edit/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

// -- identity ---------------------------------------------------------------

test("a tool id that already exists is rejected", async () => {
  await withFakeDatabase(
    [EDITOR, siblings({ toolId: `${APP}.${KEY}`, slug: "something-else", order: 0 })],
    async (state) => {
      await expect(() => createManagedTool("actor", DRAFT)).rejects.toThrow(
        new RegExp(`Tool ${APP}\\.${KEY} already exists`),
      );
      expect(state.inserts).toEqual([]);
    },
  );
});

test("a folder key that is not a valid slug is rejected before any read", async () => {
  for (const key of ["Not A Key", "trailing-", "double--hyphen", "under_score"]) {
    await withFakeDatabase([EDITOR], async (state) => {
      await expect(() => createManagedTool("actor", { ...DRAFT, key })).rejects.toThrow(
        /Folder key must be lowercase words/,
      );
      expect(state.inserts).toEqual([]);
    });
  }
});

test("an app outside devtools and media is rejected", async () => {
  await withFakeDatabase([EDITOR], async (state) => {
    await expect(() => createManagedTool("actor", { ...DRAFT, app: "paperwork" })).rejects.toThrow(
      /must be "devtools" or "media"/,
    );
    expect(state.inserts).toEqual([]);
  });
});

// -- slug -------------------------------------------------------------------

test("a reserved slug is rejected", async () => {
  await withFakeDatabase([EDITOR], async (state) => {
    await expect(() => createManagedTool("actor", { ...DRAFT, slug: RESERVED_SLUG })).rejects.toThrow(
      /invalid or reserved/,
    );
    expect(state.inserts).toEqual([]);
  });
});

test("a slug already used by the same app is rejected", async () => {
  await withFakeDatabase(
    [EDITOR, siblings({ toolId: `${APP}.other`, slug: "aardvark-widget", order: 0 })],
    async (state) => {
      await expect(() => createManagedTool("actor", DRAFT)).rejects.toThrow(/already in use/);
      expect(state.inserts).toEqual([]);
    },
  );
});

test("a blank slug falls back to the name, recomputed on the server", async () => {
  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", { ...DRAFT, slug: "   " });
    expect(toolWrite(state).values.slug).toBe("aardvark-widget");
  });
});

// -- category ---------------------------------------------------------------

test("a category outside the registry is rejected", async () => {
  await withFakeDatabase([EDITOR], async (state) => {
    await expect(() => createManagedTool("actor", { ...DRAFT, category: "totally-made-up" })).rejects.toThrow(
      /not registered for devtools/,
    );
    expect(state.inserts).toEqual([]);
  });
});

test("a category belonging to the other app is rejected", async () => {
  await withFakeDatabase([EDITOR], async (state) => {
    await expect(() => createManagedTool("actor", { ...DRAFT, category: OTHER_APP_CATEGORY })).rejects.toThrow(
      /not registered for devtools/,
    );
    expect(state.inserts).toEqual([]);
  });
});

// -- order ------------------------------------------------------------------

test("order appends above every existing row, so UNIQUE (app, sort_order) cannot collide", async () => {
  // Gaps and out-of-sequence rows included on purpose: the next value is one
  // above the highest, never a count and never a reused gap.
  await withFakeDatabase(
    [
      EDITOR,
      siblings(
        { toolId: `${APP}.a`, slug: "a", order: 7 },
        { toolId: `${APP}.b`, slug: "b", order: 2 },
        { toolId: `${APP}.c`, slug: "c", order: 0 },
      ),
    ],
    async (state) => {
      await createManagedTool("actor", DRAFT);
      expect(toolWrite(state).values.order).toBe(8);
    },
  );

  // The first tool of an app starts at zero rather than at one.
  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", DRAFT);
    expect(toolWrite(state).values.order).toBe(0);
  });
});

// -- the created rows -------------------------------------------------------

test("a created tool is disabled, unarchived, and paired with a tool_content row", async () => {
  await withFakeDatabase([EDITOR, siblings({ toolId: `${APP}.a`, slug: "a", order: 0 })], async (state) => {
    const created = await createManagedTool("actor", DRAFT);

    const { values } = toolWrite(state);
    expect(values.toolId).toBe(`${APP}.${KEY}`);
    expect(values.app).toBe(APP);
    expect(values.slug).toBe("aardvark-widget");
    expect(values.name).toBe("Aardvark Widget");
    expect(values.description).toBe("Does an aardvark-shaped thing.");
    expect(values.order).toBe(1);
    expect(values.enabled).toBe(false);
    expect(values.archived).toBe(false);
    expect(created.toolId).toBe(`${APP}.${KEY}`);

    // The content row carries the chosen category and nothing else. Every
    // other column stays null so it inherits from the stored spec; the
    // category is persisted because the form asked for it.
    expect(contentWrite(state).values).toEqual({
      toolId: `${APP}.${KEY}`,
      category: CATEGORY,
    });

    const audit = auditWrite(state);
    expect(audit.values.action).toBe("tool.create");
    expect(audit.values.targetId).toBe(`${APP}.${KEY}`);
    expect(audit.values.metadata.category).toBe(CATEGORY);
    expect(audit.values.metadata.order).toBe(1);
  });
});

test("name and description are required and stored trimmed", async () => {
  for (const field of ["name", "description"]) {
    await withFakeDatabase([EDITOR], async (state) => {
      await expect(() => createManagedTool("actor", { ...DRAFT, [field]: "   " })).rejects.toThrow(/is required/);
      expect(state.inserts).toEqual([]);
    });
  }

  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", {
      ...DRAFT,
      name: "  Aardvark Widget  ",
      description: "  Does an aardvark-shaped thing.  ",
    });
    expect(toolWrite(state).values.name).toBe("Aardvark Widget");
    expect(toolWrite(state).values.description).toBe("Does an aardvark-shaped thing.");
  });
});

// -- optional spec ----------------------------------------------------------

/** A stored spec re-addressed to the tool being created, so only the case under test differs. */
async function specFor(overrides = {}) {
  const stored = await toolSpec("gradient-generator");
  return { ...stored, toolId: `${APP}.${KEY}`, app: APP, ...overrides };
}

test("a valid spec is validated and stored as the draft, never as the live spec", async () => {
  const spec = await specFor();
  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", { ...DRAFT, spec });

    const { values } = toolWrite(state);
    expect(values.specDraft).toEqual(spec);
    expect(values).not.toHaveProperty("spec");
    expect(auditWrite(state).values.metadata.hasSpecDraft).toBe(true);
  });
});

test("the draft keeps the author's key order because the raw JSON is stored", async () => {
  const spec = await specFor();
  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", { ...DRAFT, spec });
    expect(Object.keys(toolWrite(state).values.specDraft)).toEqual(Object.keys(spec));
  });
});

test("a spec that fails the schema is rejected with issues and writes nothing", async () => {
  const spec = await specFor({ trigger: "nonsense" });
  await withFakeDatabase([EDITOR], async (state) => {
    const error = await createManagedTool("actor", { ...DRAFT, spec }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ToolSpecValidationError);
    expect(error.issues.some((issue) => /trigger/.test(issue))).toBe(true);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("a spec whose toolId belongs to another tool is rejected and writes nothing", async () => {
  const spec = await specFor({ toolId: "devtools.other-tool" });
  await withFakeDatabase([EDITOR], async (state) => {
    const error = await createManagedTool("actor", { ...DRAFT, spec }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ToolSpecValidationError);
    expect(error.issues).toEqual([`toolId: must be "${APP}.${KEY}"`]);
    expect(state.inserts).toEqual([]);
  });
});

test("a spec whose app differs from the new tool's app is rejected and writes nothing", async () => {
  const spec = await specFor({ app: "media" });
  await withFakeDatabase([EDITOR], async (state) => {
    const error = await createManagedTool("actor", { ...DRAFT, spec }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ToolSpecValidationError);
    expect(error.issues.some((issue) => /^app: /.test(issue))).toBe(true);
    expect(state.inserts).toEqual([]);
  });
});

test("a spec over a system limit is rejected and writes nothing", async () => {
  const spec = await specFor();
  limits.violations = ["input.maxLength 9 exceeds max_editable_text_chars 1"];
  await withFakeDatabase([EDITOR], async (state) => {
    const error = await createManagedTool("actor", { ...DRAFT, spec }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ToolSpecValidationError);
    expect(error.issues).toEqual(limits.violations);
    expect(state.inserts).toEqual([]);
  });
});

test("without a spec the tool is created with no draft and an audit that says so", async () => {
  await withFakeDatabase([EDITOR, siblings()], async (state) => {
    await createManagedTool("actor", DRAFT);

    const { values } = toolWrite(state);
    expect(values.specDraft).toBeNull();
    expect(values).not.toHaveProperty("spec");
    expect(auditWrite(state).values.metadata.hasSpecDraft).toBe(false);
  });
});
