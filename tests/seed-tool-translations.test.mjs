import { expect, test } from "vitest";
import { backfillToolTranslations } from "../db/seedManagedTools.ts";
import { managedToolsTable, toolContentTable } from "../db/schema.ts";
import { extractToolMessages } from "../lib/tool-framework/translations.ts";
import spec from "../tools/base64-decoder/definition.ts";
import { getPaperworkToolMessages } from "../lib/paperwork/toolMessages.ts";

function databaseFor(initial, content = null) {
  const state = { row: structuredClone(initial), writes: 0, locks: 0 };
  const database = {
    select() {
      let table;
      const chain = {
        from(value) {
          table = value;
          return chain;
        },
        where: () => chain,
        limit: () => chain,
        for() {
          state.locks++;
          return chain;
        },
        then(resolve) {
          return Promise.resolve(table === managedToolsTable ? [state.row] : content ? [content] : []).then(resolve);
        },
      };
      return chain;
    },
    update(table) {
      expect(table).toBe(managedToolsTable);
      return {
        set(values) {
          return {
            async where() {
              state.row = { ...state.row, ...values };
              state.writes++;
            },
          };
        },
      };
    },
    transaction: async (operation) => operation(database),
  };
  return { database, state };
}

const SCAN = { definitions: [{ definitionKey: "base64-decoder", spec }], migrated: 1, skipped: 0, total: 1 };
const ROW = { toolId: spec.toolId, name: "Customized decoder", description: "Stored description", translations: {} };

test("translation backfill uses published source content and is idempotent", async () => {
  const { database, state } = databaseFor(ROW, {
    toolId: spec.toolId,
    category: null,
    keywords: null,
    seoTitle: "Stored SEO title",
    seoDescription: "Stored SEO description",
    contentDoc: { version: 1, howToUse: ["Stored instructions"] },
    docVersion: 1,
    publishedAt: new Date(),
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  const english = state.row.translations.en;
  expect(english.status).toBe("published");
  expect(english.messages.name).toBe(ROW.name);
  expect(english.messages.seoTitle).toBe("Stored SEO title");
  expect(english.messages["content.howToUse.0"]).toBe("Stored instructions");
  expect(await backfillToolTranslations(database, SCAN)).toBe(0);
  expect(state.writes).toBe(1);
  expect(state.locks).toBe(2);
});

test("new source fields preserve saved English and translated messages while requiring review", async () => {
  const french = { name: "Décodeur" };
  const { database, state } = databaseFor({
    ...ROW,
    translations: {
      en: { status: "published", messages: { name: "Saved English", description: "Saved description" } },
      fr: { status: "published", messages: french },
    },
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  expect(state.row.translations.en.messages.name).toBe("Saved English");
  expect(state.row.translations.en.messages["input.label"]).toBe(extractToolMessages(spec)["input.label"]);
  expect(state.row.translations.fr).toEqual({ status: "draft", messages: french });
});

test("Paperwork source copy initializes without requiring a tool definition", async () => {
  const { database, state } = databaseFor({
    toolId: "paperwork.invoice",
    name: "Invoice {PDF}",
    description: "Create an invoice",
    translations: {},
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  expect(state.row.translations.en).toEqual({
    status: "published",
    messages: {
      name: "Invoice '{'PDF'}'",
      description: "Create an invoice",
    },
  });
});

test("retired English keys are pruned without resetting retained edits and translations require review", async () => {
  const source = extractToolMessages({ ...spec, name: ROW.name, description: ROW.description });
  const { database, state } = databaseFor({
    ...ROW,
    translations: {
      en: { status: "published", messages: { ...source, name: "Saved English", "runtime.retired": "Old control" } },
      fr: { status: "published", messages: { name: "Décodeur", "runtime.retired": "Ancien contrôle" } },
    },
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  expect(state.row.translations.en.messages.name).toBe("Saved English");
  expect(state.row.translations.en.messages).not.toHaveProperty("runtime.retired");
  expect(state.row.translations.fr.status).toBe("draft");
  expect(state.row.translations.fr.messages["runtime.retired"]).toBe("Ancien contrôle");
  expect(await backfillToolTranslations(database, SCAN)).toBe(0);
});

test("Paperwork backfill requires each host's editable interface messages and preserves saved English", async () => {
  const { database, state } = databaseFor({
    toolId: "paperwork.invoice-generator",
    app: "paperwork",
    name: "Invoice",
    description: "Create an invoice",
    translations: {
      en: {
        status: "published",
        messages: {
          name: "Saved invoice title",
          description: "Create an invoice",
          "runtime.shared.app.clear": "Clear saved work",
        },
      },
    },
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  const messages = state.row.translations.en.messages;
  expect(messages.name).toBe("Saved invoice title");
  for (const [key, value] of Object.entries(getPaperworkToolMessages("invoice-generator"))) {
    expect(messages[key]).toBe(key === "runtime.shared.app.clear" ? "Clear saved work" : value);
  }
  expect(await backfillToolTranslations(database, SCAN)).toBe(0);
});

test("saved English that no longer fits the code's placeholders is replaced by the source", async () => {
  const source = extractToolMessages({ ...spec, name: ROW.name, description: ROW.description });
  const { database, state } = databaseFor({
    ...ROW,
    translations: {
      en: { status: "published", messages: { ...source, name: "Decoder for {who}", description: "Saved" } },
    },
  });
  expect(await backfillToolTranslations(database, SCAN)).toBe(1);
  expect(state.row.translations.en.messages.name).toBe(ROW.name);
  expect(state.row.translations.en.messages.description).toBe("Saved");
});
