import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  importSnapshots,
  planImport,
  readSnapshots,
  snapshotPath,
  validateSnapshot,
} from "../db/scripts/tool-translations.mjs";

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");

const english = { name: "Example", "runtime.hello": "Hello {name}" };
const snapshot = (toolId = "devtools.example") => ({
  toolId,
  translations: {
    en: { status: "published", messages: { ...english } },
    es: { status: "published", messages: { name: "Ejemplo", "runtime.hello": "Hola {name}" } },
    fr: { status: "draft", messages: { name: "Exemple" } },
  },
});
const row = (toolId = "devtools.example") => ({
  tool_id: toolId,
  translations: { en: { status: "published", messages: { ...english } } },
});

test("validates published translations and incomplete drafts against the source", () => {
  assert.deepEqual(validateSnapshot(snapshot()), []);
  const invalid = snapshot();
  invalid.translations.es.messages["runtime.hello"] = "Hola {other}";
  assert.match(validateSnapshot(invalid).join("\n"), /Keep the same placeholders/);
  invalid.translations.es.messages["runtime.hello"] = "";
  assert.match(validateSnapshot(invalid).join("\n"), /Translate this field before publishing/);
});

test("rejects invalid source, unsupported locale/status, extra fields and unsafe keys", () => {
  const cases = [
    { ...snapshot(), credential: "must not export" },
    { ...snapshot(), toolId: "devtools.../escape" },
    { toolId: "devtools.example", translations: {} },
    { ...snapshot(), translations: { ...snapshot().translations, zz: { status: "published", messages: english } } },
    { ...snapshot(), translations: { en: { status: "live", messages: english } } },
    { ...snapshot(), translations: { en: { status: "published", messages: { name: "{broken" } } } },
    { ...snapshot(), translations: { en: { status: "draft", messages: { "__proto__.name": "Unsafe" } } } },
    { ...snapshot(), translations: { en: { status: "published", messages: { name: 42 } } } },
  ];
  for (const value of cases) assert.ok(validateSnapshot(value).length, JSON.stringify(value));
});

test("checks every parent prefix even when another sorted key falls between them", () => {
  const value = snapshot();
  value.translations = {
    en: { status: "draft", messages: { a: "One", "a-other": "Two", "a.b": "Three" } },
  };
  assert.match(validateSnapshot(value).join("\n"), /conflicts with a parent key/);
});

test("requires the target language's plural forms before publishing", () => {
  const value = snapshot();
  value.translations = {
    en: { status: "published", messages: { count: "{n, plural, one {# file} other {# files}}" } },
    ar: { status: "published", messages: { count: "{n, plural, one {ملف} other {ملفات}}" } },
  };
  assert.match(validateSnapshot(value).join("\n"), /plural form for ar/);
  value.translations.ar.status = "draft";
  assert.deepEqual(validateSnapshot(value), []);
});

test("adds only missing locales, preserves all administrator data, and is idempotent", () => {
  const current = row();
  current.translations.en.status = "draft";
  current.translations.es = { status: "draft", messages: { name: "Admin edit" } };
  current.translations.de = { status: "draft", messages: { name: "Vorhanden" } };
  const before = structuredClone(current);
  const plan = planImport([snapshot()], [current]);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0].addedLocales, ["fr"]);
  assert.deepEqual(plan.updates[0].translations.en, current.translations.en);
  assert.deepEqual(plan.updates[0].translations.es, current.translations.es);
  assert.deepEqual(plan.updates[0].translations.de, current.translations.de);
  assert.deepEqual(current, before, "Planning must not mutate the database object");
  assert.deepEqual(plan.preserved, [
    { toolId: "devtools.example", locale: "en" },
    { toolId: "devtools.example", locale: "es" },
  ]);
  const second = planImport([snapshot()], [{ ...current, translations: plan.updates[0].translations }]);
  assert.deepEqual(second.updates, []);
  assert.deepEqual(second.unchanged, ["devtools.example"]);
});

test("force overwrites differing locales and English source but keeps DB-only locales", () => {
  const current = row();
  current.translations.en.messages = { name: "Old" };
  current.translations.es = { status: "draft", messages: { name: "Admin edit" } };
  current.translations.de = { status: "draft", messages: { name: "Vorhanden" } };
  const [update] = planImport([snapshot()], [current], { force: true }).updates;
  assert.deepEqual(update.translations.en, snapshot().translations.en);
  assert.deepEqual(update.translations.es, snapshot().translations.es);
  assert.deepEqual(update.translations.fr, snapshot().translations.fr);
  assert.deepEqual(update.translations.de, current.translations.de);
});

test("compares English keys and text exactly, independently of property order", () => {
  const reordered = row();
  reordered.translations.en.messages = { "runtime.hello": "Hello {name}", name: "Example" };
  assert.equal(planImport([snapshot()], [reordered]).updates.length, 1);
  for (const messages of [{ ...english, name: "Changed" }, { ...english, extra: "New source" }, { name: "Example" }]) {
    assert.throws(
      () => planImport([snapshot()], [{ ...row(), translations: { en: { status: "published", messages } } }]),
      /English source differs/,
    );
  }
});

test("reports absent tools without creating records and rejects duplicate identities", () => {
  const plan = planImport([snapshot(), snapshot("media.absent")], [row()]);
  assert.deepEqual(plan.missing, ["media.absent"]);
  assert.equal(plan.updates.length, 1);
  assert.throws(() => planImport([snapshot(), snapshot()], [row()]), /Duplicate snapshot/);
});

function fakeClient(rows, { failUpdate = 0 } = {}) {
  const calls = [];
  let updates = 0;
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT")) return { rows: structuredClone(rows) };
      if (sql.startsWith("UPDATE")) {
        if (++updates === failUpdate) throw new Error("database write failed");
        return { rowCount: 1 };
      }
      return {};
    },
  };
}

test("dry run does not start a transaction, lock records or write", async () => {
  const client = fakeClient([row()]);
  const result = await importSnapshots(client, [snapshot()]);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.updates.length, 1);
  assert.equal(client.calls.length, 1);
  assert.ok(client.calls[0].sql.startsWith("SELECT"));
  assert.ok(!client.calls[0].sql.includes("FOR UPDATE"));
});

test("apply locks records and commits a parameterized update", async () => {
  const client = fakeClient([row()]);
  const result = await importSnapshots(client, [snapshot()], { apply: true });
  assert.equal(result.mode, "applied");
  assert.equal(client.calls[0].sql, "BEGIN");
  assert.ok(client.calls.find(({ sql }) => sql.startsWith("SELECT")).sql.endsWith("FOR UPDATE"));
  const update = client.calls.find(({ sql }) => sql.startsWith("UPDATE"));
  assert.equal(update.values[1], "devtools.example");
  assert.deepEqual(JSON.parse(update.values[0]), snapshot().translations);
  assert.equal(client.calls.at(-1).sql, "COMMIT");
});

test("validates every matching source before writing and rolls back any write failure", async () => {
  const different = row("media.other");
  different.translations.en.messages.name = "Different source";
  const mismatch = fakeClient([row(), different]);
  await assert.rejects(
    importSnapshots(mismatch, [snapshot(), snapshot("media.other")], { apply: true }),
    /English source differs/,
  );
  assert.ok(!mismatch.calls.some(({ sql }) => sql.startsWith("UPDATE")));
  assert.equal(mismatch.calls.at(-1).sql, "ROLLBACK");
  const failure = fakeClient([row(), row("media.other")], { failUpdate: 2 });
  await assert.rejects(
    importSnapshots(failure, [snapshot(), snapshot("media.other")], { apply: true }),
    /database write failed/,
  );
  assert.equal(failure.calls.filter(({ sql }) => sql.startsWith("UPDATE")).length, 2);
  assert.equal(failure.calls.at(-1).sql, "ROLLBACK");
  assert.ok(!failure.calls.some(({ sql }) => sql === "COMMIT"));
});

test("invalid snapshot content fails before any database operation", async () => {
  const client = fakeClient([row()]);
  await assert.rejects(importSnapshots(client, [{ toolId: "devtools.example" }], { apply: true }), /Translations/);
  assert.deepEqual(client.calls, []);
});

test("discovers only owner snapshots and requires moves when an implementation becomes available", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "canopy-translation-snapshots-"));
  try {
    const value = snapshot();
    const fallback = await snapshotPath(value.toolId, root);
    assert.equal(fallback, path.join(root, "db/seed-data/tool-translations/devtools.example/translations.json"));
    await mkdir(path.dirname(fallback), { recursive: true });
    await writeFile(fallback, JSON.stringify(value));
    assert.deepEqual(await readSnapshots({ root }), [value]);
    await mkdir(path.join(root, "tools/example"), { recursive: true });
    await writeFile(path.join(root, "tools/example/definition.ts"), 'export default { toolId: "devtools.example" };');
    assert.equal(await snapshotPath(value.toolId, root), path.join(root, "tools/example/translations.json"));
    await assert.rejects(readSnapshots({ root }), /Move the snapshot/);
    await assert.rejects(snapshotPath("media.example", root), /belongs to devtools.example/);
    await assert.rejects(snapshotPath("devtools.../escape", root), /Invalid stable tool ID/);
    assert.equal(
      await snapshotPath("paperwork.receipt-generator", root),
      path.join(root, "app/paperwork/components/receipt/translations.json"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
