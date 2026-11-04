import { toolSpec } from "./helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { auditEventsTable, db, managedToolsTable } from "../db/index.ts";
import {
  saveToolTranslation,
  setManagedToolEnabled,
  toolTranslationSource,
  updateToolContent,
} from "../lib/admin/adminMutations.ts";

const specFixture = vi.hoisted(() => ({ value: null }));
afterEach(() => {
  specFixture.value = null;
});

const TOOL_ID = "devtools.translated-tool";
const UPDATED_AT = new Date("2026-09-30T09:00:00.000Z");
const ENGLISH = { name: "Text tool", description: "Process text" };
const ROW = {
  toolId: TOOL_ID,
  app: "devtools",
  slug: "translated-tool",
  name: "Text tool",
  description: "Process text",
  enabled: true,
  archived: false,
  order: 0,
  updatedAt: UPDATED_AT,
  translations: {
    en: { status: "published", messages: ENGLISH },
    fr: { status: "published", messages: { name: "Texte", description: "Traiter le texte" } },
  },
};

vi.mock("@/lib/tool-framework/catalog.ts", () => ({
  definitionKeyOf: (toolId) => toolId.split(".")[1],
  specFromRow: async () => specFixture.value,
}));

function permissionRows(access = { edit: true, toggle: true }) {
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

async function withDatabase(row, callback, access, additionalReads = []) {
  const writes = [];
  const original = db.transaction;
  const reads = [permissionRows(access), [structuredClone(row)], ...additionalReads];
  const transaction = {
    select() {
      const result = reads.shift() ?? permissionRows(access);
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
        returning: () => Promise.resolve([{ ...row, ...entry.values }]),
        then: (resolve) => Promise.resolve([]).then(resolve),
      };
      return chain;
    },
    insert(table) {
      const entry = { table };
      writes.push(entry);
      const chain = {
        values(values) {
          entry.values = values;
          return chain;
        },
        onConflictDoUpdate({ set }) {
          entry.set = set;
          return chain;
        },
        returning: () => Promise.resolve([entry.values]),
        then: (resolve) => Promise.resolve([]).then(resolve),
      };
      return chain;
    },
  };
  db.transaction = async (operation) => operation(transaction);
  try {
    await callback(writes);
  } finally {
    db.transaction = original;
  }
}

function edit(messages, extra = {}) {
  return { locale: "hi", status: "draft", messages, updatedAt: UPDATED_AT.toISOString(), ...extra };
}

test("translation drafts preserve other languages and audit only metadata", async () => {
  await withDatabase(ROW, async (writes) => {
    const result = await saveToolTranslation("actor", TOOL_ID, edit({ name: "पाठ उपकरण" }));
    const saved = writes.find((write) => write.table === managedToolsTable).values;
    expect(saved.translations.hi).toEqual({ status: "draft", messages: { name: "पाठ उपकरण" } });
    expect(saved.translations.fr).toEqual(ROW.translations.fr);
    expect(result.updatedAt).not.toBe(UPDATED_AT.toISOString());
    const audit = writes.find((write) => write.table === auditEventsTable).values;
    expect(audit.action).toBe("tool.translation-edit");
    expect(JSON.stringify(audit.metadata)).not.toContain("पाठ उपकरण");
  });
});

test("translation save rejects stale edits without writes", async () => {
  await withDatabase(ROW, async (writes) => {
    await expect(
      saveToolTranslation("actor", TOOL_ID, edit({}, { updatedAt: "2026-09-29T00:00:00.000Z" })),
    ).rejects.toThrow(/changed.*reload/i);
    expect(writes).toEqual([]);
  });
});

test("publication requires complete messages and rejects unknown text keys", async () => {
  for (const input of [
    edit({ name: "पाठ" }, { status: "published" }),
    edit({ name: "पाठ", "execution.host": "server" }),
  ]) {
    await withDatabase(ROW, async (writes) => {
      await expect(saveToolTranslation("actor", TOOL_ID, input)).rejects.toThrow(/translation/i);
      expect(writes).toEqual([]);
    });
  }
});

test("changing English marks translated languages draft and synchronizes catalog copy", async () => {
  await withDatabase(ROW, async (writes) => {
    await saveToolTranslation(
      "actor",
      TOOL_ID,
      edit({ ...ENGLISH, name: "New name" }, { locale: "en", status: "published" }),
    );
    const saved = writes.find((write) => write.table === managedToolsTable).values;
    expect(saved.name).toBe("New name");
    expect(saved.translations.en.messages.name).toBe("New name");
    expect(saved.translations.fr.status).toBe("draft");
  });
});

test("an enabled tool cannot move English to draft", async () => {
  await withDatabase(ROW, async (writes) => {
    await expect(saveToolTranslation("actor", TOOL_ID, edit(ENGLISH, { locale: "en" }))).rejects.toThrow(
      /English.*published/,
    );
    expect(writes).toEqual([]);
  });
});

test("enabling rejects absent, incomplete, invalid, and obsolete English publication without writing", async () => {
  for (const translations of [
    undefined,
    {},
    { en: { status: "draft", messages: { name: ROW.name, description: ROW.description } } },
    { en: { status: "published", messages: { name: ROW.name } } },
    { en: { status: "published", messages: { name: "{bad", description: ROW.description } } },
    { en: { status: "published", messages: { name: ROW.name, description: ROW.description, obsolete: "Old field" } } },
  ]) {
    await withDatabase({ ...ROW, enabled: false, translations }, async (writes) => {
      await expect(setManagedToolEnabled("actor", TOOL_ID, true)).rejects.toThrow(/English|translation/i);
      expect(writes).toEqual([]);
    });
  }
  await withDatabase(
    {
      ...ROW,
      enabled: false,
      translations: { en: { status: "published", messages: { name: ROW.name, description: ROW.description } } },
    },
    async (writes) => {
      await setManagedToolEnabled("actor", TOOL_ID, true);
      expect(writes.find((write) => write.table === managedToolsTable).values.enabled).toBe(true);
    },
  );
});

test("translation writes require edit permission", async () => {
  await withDatabase(
    ROW,
    async (writes) => {
      await expect(saveToolTranslation("actor", TOOL_ID, edit({}))).rejects.toThrow(/tools.edit/);
      expect(writes).toEqual([]);
    },
    { edit: false, toggle: true },
  );
});

test("publishing requires toggle permission as well as editing", async () => {
  await withDatabase(
    ROW,
    async (writes) => {
      await expect(saveToolTranslation("actor", TOOL_ID, edit(ENGLISH, { status: "published" }))).rejects.toThrow(
        /tools.toggle/,
      );
      expect(writes).toEqual([]);
    },
    { edit: true, toggle: false },
  );
});

test("unchanged English publication keeps other published languages live", async () => {
  await withDatabase(ROW, async (writes) => {
    await saveToolTranslation("actor", TOOL_ID, edit(ENGLISH, { locale: "en", status: "published" }));
    expect(writes.find((write) => write.table === managedToolsTable).values.translations.fr.status).toBe("published");
  });
});

test("English publication removes retired keys and cannot add undeclared runtime placeholders", async () => {
  const row = {
    ...ROW,
    translations: { ...ROW.translations, en: { status: "published", messages: { ...ENGLISH, retired: "Old field" } } },
  };
  await withDatabase(row, async (writes) => {
    await saveToolTranslation("actor", TOOL_ID, edit(ENGLISH, { locale: "en", status: "published" }));
    const translations = writes.find((write) => write.table === managedToolsTable).values.translations;
    expect(translations.en.messages).toEqual(ENGLISH);
    expect(translations.fr.status).toBe("draft");
  });
  await withDatabase(ROW, async (writes) => {
    await expect(
      saveToolTranslation(
        "actor",
        TOOL_ID,
        edit({ ...ENGLISH, name: "Found {count} files" }, { locale: "en", status: "published" }),
      ),
    ).rejects.toThrow(/placeholders/);
    expect(writes).toEqual([]);
  });
});

test("locale and placeholder validation prevent invalid stored translations", async () => {
  const row = {
    ...ROW,
    translations: { en: { status: "published", messages: { name: "Found {count, number} files" } } },
  };
  for (const input of [
    edit({ name: "Files" }),
    edit({ name: "Files {other}" }),
    edit({ name: "Files {count" }),
    edit({}, { locale: "xx" }),
  ]) {
    await withDatabase(row, async (writes) => {
      await expect(saveToolTranslation("actor", TOOL_ID, input)).rejects.toThrow(/translation/i);
      expect(writes).toEqual([]);
    });
  }
});

test("editing published source content updates English and drafts translations without resetting custom labels", async () => {
  specFixture.value = {
    toolId: TOOL_ID,
    app: "devtools",
    name: "Text tool",
    description: "Process text",
    category: "encoding-decoding",
    keywords: [],
    input: { kind: "none" },
    settings: { fields: {} },
    trigger: { mode: "manual", actionLabel: "Run" },
    labels: { empty: "Start", ready: "Ready", running: "Running" },
    content: { howToUse: ["First step", "Second step"] },
  };
  const content = {
    toolId: TOOL_ID,
    category: null,
    keywords: null,
    seoTitle: null,
    seoDescription: null,
    contentDoc: null,
    docVersion: 1,
    publishedAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
  };
  const source = toolTranslationSource(specFixture.value, ROW, content);
  const row = {
    ...ROW,
    translations: {
      ...ROW.translations,
      en: {
        status: "published",
        messages: {
          ...source,
          "labels.ready": "Custom ready label",
        },
      },
    },
  };
  await withDatabase(
    row,
    async (writes) => {
      await updateToolContent("actor", TOOL_ID, {
        category: null,
        keywords: null,
        seoTitle: null,
        seoDescription: null,
        contentDoc: { howToUse: ["Second step", "First step"] },
      });
      const saved = writes.filter((write) => write.table === managedToolsTable).at(-1).values;
      expect(saved.translations.en.messages["content.howToUse.0"]).toBe("Second step");
      expect(saved.translations.en.messages["labels.ready"]).toBe("Custom ready label");
      expect(saved.translations.fr.status).toBe("draft");
    },
    undefined,
    [[{ toolId: TOOL_ID }], [content]],
  );
});

test("Paperwork admin translation source includes per-host interface and shared validation messages", () => {
  const source = toolTranslationSource(
    null,
    {
      toolId: "paperwork.w9-request",
      app: "paperwork",
      name: "W9",
      description: "Request a form",
    },
    null,
  );
  expect(source.name).toBe("W9");
  expect(source["runtime.w9.requestDisclaimer"]).toContain("request only");
  expect(source["runtime.shared.validation.contractorNameRequired"]).toBe("Contractor legal name is required.");
  expect(source["runtime.nec.validation.rulesUpdateRequired"]).toContain("{year}");
  expect(source).not.toHaveProperty("runtime.invoice.invoiceDetails");
});

test("English publication round-trips configured examples without changing their inputs or settings", async () => {
  const gradient = await toolSpec("gradient-generator");
  const { resolveContent } = await import("../lib/tool-framework/content.ts");
  const { toolContentTable } = await import("../db/index.ts");
  specFixture.value = { ...gradient, toolId: TOOL_ID };
  const source = toolTranslationSource(specFixture.value, ROW, null);
  const row = { ...ROW, translations: { ...ROW.translations, en: { status: "published", messages: source } } };
  const messages = { ...source, "content.examples.0.label": "Saved blue-purple example" };
  await withDatabase(
    row,
    async (writes) => {
      await saveToolTranslation("actor", TOOL_ID, edit(messages, { locale: "en", status: "published" }));
      const content = writes.find((write) => write.table === toolContentTable).values;
      const example = resolveContent(specFixture.value, content).content.examples[0];
      expect(example).toEqual({ ...gradient.content.examples[0], label: "Saved blue-purple example" });
      expect(example.settings.angle).toBe(135);
    },
    undefined,
    [permissionRows(), []],
  );
});

test.each([
  {
    contentDoc: {
      version: 1,
      howToUse: ["Unpublished authored step"],
      examples: [{ label: "Draft example", text: "Draft input", settings: { angle: 90 } }],
    },
  },
  { contentDoc: null, seoTitle: "Unpublished SEO title", keywords: ["unpublished-keyword"] },
])("English publication leaves an authored content draft unpublished and unchanged: %j", async (draft) => {
  const gradient = await toolSpec("gradient-generator");
  const { resolveContent } = await import("../lib/tool-framework/content.ts");
  const { applyToolMessages } = await import("../lib/tool-framework/translations.ts");
  const { toolContentTable } = await import("../db/index.ts");
  specFixture.value = { ...gradient, toolId: TOOL_ID };
  const content = {
    toolId: TOOL_ID,
    category: null,
    keywords: null,
    seoTitle: null,
    seoDescription: null,
    contentDoc: null,
    docVersion: 1,
    publishedAt: null,
    updatedAt: UPDATED_AT,
    ...draft,
  };
  const source = toolTranslationSource(specFixture.value, ROW, content);
  const row = { ...ROW, translations: { ...ROW.translations, en: { status: "published", messages: source } } };
  const messages = {
    ...source,
    "content.howToUse.0": "Published English instruction",
    seoTitle: "Published English SEO",
  };
  await withDatabase(
    row,
    async (writes) => {
      await saveToolTranslation("actor", TOOL_ID, edit(messages, { locale: "en", status: "published" }));
      const contentWrite = writes.find((write) => write.table === toolContentTable);
      const persistedContent = contentWrite ? { ...content, ...contentWrite.values } : content;
      expect(persistedContent).toEqual(content);
      expect(persistedContent.publishedAt).toBeNull();
      const saved = writes.find((write) => write.table === managedToolsTable).values;
      expect(saved.translations.en.messages.seoTitle).toBe("Published English SEO");
      const resolved = resolveContent(specFixture.value, persistedContent);
      const publicSpec = applyToolMessages(
        { ...specFixture.value, content: resolved.content },
        saved.translations.en.messages,
        "en",
      );
      expect(publicSpec.content.howToUse[0]).toBe("Published English instruction");
      expect(saved.translations.fr.status).toBe("draft");
    },
    undefined,
    [permissionRows(), [content]],
  );
});
