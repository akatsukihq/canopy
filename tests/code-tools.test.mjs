import { toolSpec } from "./helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { describe, test } = await import(process.env.VITEST ? "vitest" : "node:test");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { CODE_LANGUAGES } = await import("../lib/code-execution/languages.ts");
const { clearDraft, loadDraft, saveDraft } = await import("../lib/code-execution/draft.ts");
const { shortVersion } = await import("../lib/code-execution/definition.ts");
const { TOOL_CATEGORIES } = await import("../lib/tool-framework/categories.ts");

const sqlDefinition = await toolSpec("sql-compiler");

const folders = readdirSync(path.join(root, "tools"))
  .filter((name) => name.endsWith("-compiler") && name !== "sql-compiler" && name !== "html-compiler")
  .sort();
const keys = Object.keys(CODE_LANGUAGES).sort();

describe("compiler tool folders", () => {
  test("the Compilers category exists in devtools and holds the SQL page", () => {
    assert.equal(TOOL_CATEGORIES.compilers.label, "Compilers");
    assert.equal(TOOL_CATEGORIES.compilers.app, "devtools");
    assert.equal(sqlDefinition.category, "compilers");
  });

  test("every tools/*-compiler folder (except sql-compiler) has exactly one registry entry and vice versa", () => {
    assert.deepEqual(folders, keys);
  });

  for (const key of keys) {
    test(`${key}: definition aligns with the registry and loads under plain Node`, async () => {
      const language = CODE_LANGUAGES[key];
      assert.equal(language.definitionKey, key);
      const { default: definition } = await import(`../tools/${key}/definition.ts`);
      assert.equal(definition.toolId, `devtools.${key}`);
      assert.equal(definition.slug, key);
      assert.equal(definition.app, "devtools");
      assert.equal(definition.category, "compilers");
      assert.equal(definition.trigger.mode, "manual");
      assert.equal(definition.input.maxLength, 65_536);
      assert.ok(definition.input.secondary);
      // The starter is referenced from the registry, never copied.
      assert.equal(definition.content.examples[0].text, language.starter);
      assert.match(
        definition.content.seoTitle,
        new RegExp(`^Online .+ — Run .+ ${shortVersion(language.version).replace(".", "\\.")} Code$`),
      );
      // Every runnable version is named on the page, and the picker offers exactly the registry's versions.
      for (const version of language.versions) {
        assert.ok(
          definition.content.faq.some((item) => item.a.includes(version.label) || item.a.includes(version.version)),
        );
      }
      assert.equal(definition.settings.fields.version.default, language.versionId);
      assert.deepEqual(
        definition.settings.fields.version.choices.map((choice) => choice.value),
        language.versions.map((version) => version.id),
      );
      assert.ok(definition.content.faq.length >= 4);
      assert.equal(definition.content.relatedToolIds.length, 3);
      assert.ok(!definition.content.relatedToolIds.includes(definition.toolId));
    });

    test(`${key}: run.server delegates to runCode with its own key`, async () => {
      const { vi } = process.env.VITEST ? await import("vitest") : {};
      if (!vi) return;
      vi.resetModules();
      const runCode = vi.fn(async () => ({ render: "none" }));
      vi.doMock("@/lib/code-execution/run", () => ({ runCode }));
      const module = await import(`../tools/${key}/run.server.ts`);
      const signal = new AbortController().signal;
      const input = { text: "x", secondary: "y" };
      await module.run({ input, settings: { version: "v1" }, signal });
      assert.deepEqual(runCode.mock.calls[0], [key, input, signal, "v1"]);
      assert.equal(module.default, module.run);
      vi.doUnmock("@/lib/code-execution/run");
    });
  }
});

describe("shortVersion", () => {
  test("drops patch and trailing zero segments", () => {
    assert.equal(shortVersion("3.12.0"), "3.12");
    assert.equal(shortVersion("15.0.2"), "15");
    assert.equal(shortVersion("5.0.201"), "5");
    assert.equal(shortVersion("20.11.1"), "20.11");
  });
});

describe("source draft persistence", () => {
  const memory = () => {
    const data = new Map();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };

  test("round-trips a draft per tool", () => {
    const storage = memory();
    saveDraft(storage, "python-compiler", "print(1)", "starter");
    assert.equal(loadDraft(storage, "python-compiler"), "print(1)");
    assert.equal(loadDraft(storage, "java-compiler"), null);
  });

  test("does not keep the starter, blank text, or a cleared draft", () => {
    const storage = memory();
    saveDraft(storage, "k", "edited", "starter");
    saveDraft(storage, "k", "starter", "starter");
    assert.equal(loadDraft(storage, "k"), null);
    saveDraft(storage, "k", "edited", "starter");
    saveDraft(storage, "k", "   \n", "starter");
    assert.equal(loadDraft(storage, "k"), null);
    saveDraft(storage, "k", "edited", "starter");
    clearDraft(storage, "k");
    assert.equal(loadDraft(storage, "k"), null);
  });

  test("never throws when storage is missing or blocked", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    assert.equal(loadDraft(null, "k"), null);
    assert.doesNotThrow(() => saveDraft(null, "k", "x", "s"));
    assert.equal(loadDraft(blocked, "k"), null);
    assert.doesNotThrow(() => saveDraft(blocked, "k", "x", "s"));
    assert.doesNotThrow(() => clearDraft(blocked, "k"));
  });
});

describe("translation snapshots", () => {
  test("each compiler tool ships a valid English snapshot (ICU, placeholders)", async () => {
    const { readSnapshots } = await import("../db/scripts/tool-translations.mjs");
    for (const key of keys) {
      const [snapshot] = await readSnapshots({ toolId: `devtools.${key}` });
      assert.equal(snapshot.translations.en.status, "published");
    }
  });
});
