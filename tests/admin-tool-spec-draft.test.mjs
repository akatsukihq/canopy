import { toolSpec } from "./helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { auditEventsTable, db, managedToolsTable } from "../db/index.ts";
import {
  discardToolSpecDraft,
  publishToolSpecDraft,
  saveToolSpecDraft,
  ToolSpecValidationError,
} from "../lib/admin/toolSpecDraft.ts";

const limits = vi.hoisted(() => ({ violations: [] }));
afterEach(() => {
  limits.violations = [];
});

vi.mock("@/lib/tool-framework/catalog.ts", () => ({
  definitionKeyOf: (toolId) => toolId.split(".")[1],
  specFromRow: async () => null,
}));
vi.mock("@/lib/tool-framework/systemLimits.ts", () => ({
  loadSystemLimits: async () => ({}),
  limitViolations: () => limits.violations,
}));

const UPDATED_AT = new Date("2026-10-01T09:00:00.000Z");

async function fixture() {
  const spec = await toolSpec("gradient-generator");
  const row = {
    toolId: spec.toolId,
    app: spec.app,
    slug: "gradient-generator",
    name: "Gradient",
    description: "Make gradients",
    enabled: false,
    archived: false,
    order: 0,
    updatedAt: UPDATED_AT,
    spec: null,
    specDraft: null,
    translations: {
      en: { status: "published", messages: { name: "Gradient", description: "Make gradients" } },
      fr: { status: "published", messages: { name: "Dégradé", description: "Créer des dégradés" } },
    },
  };
  return { spec, row };
}

function permissionRows(access) {
  return [
    {
      status: "active",
      roleId: "editor",
      roleName: "Editor",
      roleDescription: "Tools editor",
      roleAccess: { admin: { enter: true }, tools: { view: true, ...access } },
      roleIsSystem: false,
    },
  ];
}

async function withDatabase(row, callback, access = { edit: true }) {
  const writes = [];
  const original = db.transaction;
  const reads = [permissionRows(access), [structuredClone(row)], []];
  const transaction = {
    select() {
      const result = reads.shift() ?? [];
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        for: () => chain,
        then: (resolve) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    update(table) {
      const entry = { table };
      writes.push(entry);
      const chain = {
        set(values) {
          entry.values = values;
          return chain;
        },
        where: () => chain,
        then: (resolve) => Promise.resolve([]).then(resolve),
      };
      return chain;
    },
    insert(table) {
      const entry = { table };
      writes.push(entry);
      return {
        values(values) {
          entry.values = values;
          return Promise.resolve([]);
        },
      };
    },
  };
  db.transaction = async (operation) => operation(transaction);
  try {
    await callback(writes);
  } finally {
    db.transaction = original;
  }
}

const toolWrite = (writes) => writes.find((write) => write.table === managedToolsTable).values;
const at = UPDATED_AT.toISOString();

test("a valid spec is saved as the draft and audited", async () => {
  const { spec, row } = await fixture();
  await withDatabase(row, async (writes) => {
    const result = await saveToolSpecDraft("actor", row.toolId, { spec, updatedAt: at });
    expect(toolWrite(writes)).toMatchObject({ specDraft: spec });
    expect(toolWrite(writes)).not.toHaveProperty("spec");
    expect(result.updatedAt > at).toBe(true);
    expect(writes.find((write) => write.table === auditEventsTable).values.action).toBe("tool.spec-draft-save");
  });
});

test("invalid, mismatched, or over-limit specs are rejected with issues and no writes", async () => {
  const { spec, row } = await fixture();
  const cases = [
    [{ ...spec, trigger: "nonsense" }, [], /trigger/],
    [{ ...spec, toolId: "devtools.other-tool" }, [], /^toolId: /],
    [spec, ["input.maxLength 9 exceeds max_editable_text_chars 1"], /exceeds/],
  ];
  for (const [candidate, violations, issue] of cases) {
    limits.violations = violations;
    await withDatabase(row, async (writes) => {
      const error = await saveToolSpecDraft("actor", row.toolId, { spec: candidate, updatedAt: at }).catch((e) => e);
      expect(error).toBeInstanceOf(ToolSpecValidationError);
      expect(error.issues.some((message) => issue.test(message))).toBe(true);
      expect(writes).toEqual([]);
    });
  }
});

test("stale edits are rejected for save, publish, and discard", async () => {
  const { spec, row } = await fixture();
  const stale = "2026-09-01T00:00:00.000Z";
  for (const run of [
    () => saveToolSpecDraft("actor", row.toolId, { spec, updatedAt: stale }),
    () => publishToolSpecDraft("actor", row.toolId, { updatedAt: stale }),
    () => discardToolSpecDraft("actor", row.toolId, { updatedAt: stale }),
  ]) {
    await withDatabase({ ...row, specDraft: spec }, async (writes) => {
      await expect(run()).rejects.toThrow(/changed.*reload/i);
      expect(writes).toEqual([]);
    });
  }
});

test("publishing copies the draft to spec, clears it, and syncs English", async () => {
  const { spec, row } = await fixture();
  await withDatabase({ ...row, specDraft: spec }, async (writes) => {
    await publishToolSpecDraft("actor", row.toolId, { updatedAt: at });
    const saved = toolWrite(writes);
    expect(saved.spec).toEqual(spec);
    expect(saved.specDraft).toBeNull();
    // English gains the spec's messages while keeping the row's name, and other
    // languages go back to draft because the source key set changed.
    expect(saved.translations.en.messages.name).toBe("Gradient");
    expect(Object.keys(saved.translations.en.messages).length).toBeGreaterThan(2);
    expect(saved.translations.fr.status).toBe("draft");
  });
});

test("publishing with no draft fails without writes", async () => {
  const { row } = await fixture();
  await withDatabase(row, async (writes) => {
    await expect(publishToolSpecDraft("actor", row.toolId, { updatedAt: at })).rejects.toThrow(/no spec draft/);
    expect(writes).toEqual([]);
  });
});

test("discarding clears the draft and leaves spec alone", async () => {
  const { spec, row } = await fixture();
  await withDatabase({ ...row, specDraft: spec }, async (writes) => {
    await discardToolSpecDraft("actor", row.toolId, { updatedAt: at });
    expect(toolWrite(writes)).toMatchObject({ specDraft: null });
    expect(toolWrite(writes)).not.toHaveProperty("spec");
  });
});

test("every spec draft operation requires tools.edit", async () => {
  const { spec, row } = await fixture();
  for (const run of [
    () => saveToolSpecDraft("actor", row.toolId, { spec, updatedAt: at }),
    () => publishToolSpecDraft("actor", row.toolId, { updatedAt: at }),
    () => discardToolSpecDraft("actor", row.toolId, { updatedAt: at }),
  ]) {
    await withDatabase(
      { ...row, specDraft: spec },
      async (writes) => {
        await expect(run()).rejects.toThrow(/tools.edit/);
        expect(writes).toEqual([]);
      },
      { edit: false },
    );
  }
});
