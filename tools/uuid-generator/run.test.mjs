import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("uuid-generator");
import { run } from "./run.ts";

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const VECTORS = {
  v3: "5df41881-3aed-3515-88a7-2f4a814cf09e",
  v5: "2ed6657d-e927-568b-95e1-2665a8aea6a2",
};

async function execute(settings = {}, { signal = new AbortController().signal, raw = false } = {}) {
  return run({
    input: { text: "", files: [] },
    settings: raw
      ? { ...parseSettings(definition.settings, {}), ...settings }
      : parseSettings(definition.settings, settings),
    signal,
  });
}

test("UUID v3/v5 match RFC 9562 DNS vectors and generate one stable value regardless of batch count", async () => {
  for (const [version, expected] of Object.entries(VECTORS)) {
    const settings = { version, namespace: DNS_NAMESPACE, name: "www.example.com", count: 100 };
    assert.deepEqual(await execute(settings), { render: "list", items: [expected], downloadName: "uuids.txt" });
    assert.deepEqual((await execute(settings)).items, [expected]);
  }
});

test("UUID v3/v5 preserve UTF-8 names and surrounding whitespace while honoring output formatting", async () => {
  for (const [version, expected] of [
    ["v3", "34ddf401-ba1d-3aeb-884b-bb1c23964bb0"],
    ["v5", "2be3d6ba-76d1-5eca-84c0-292249217576"],
  ]) {
    const settings = {
      version,
      namespace: "custom",
      customNamespace: ` ${DNS_NAMESPACE.toUpperCase()} `,
      name: " 👩‍💻 café 東京 ",
    };
    assert.deepEqual((await execute(settings)).items, [expected]);
    assert.deepEqual((await execute({ ...settings, hyphens: false, upper: true })).items, [
      expected.replaceAll("-", "").toUpperCase(),
    ]);
    assert.notDeepEqual((await execute({ ...settings, name: settings.name.trim() })).items, [expected]);
  }
});

test("UUID name-based generation rejects missing names and invalid custom namespaces with recovery", async () => {
  for (const version of ["v3", "v5"]) {
    await assert.rejects(execute({ version, namespace: DNS_NAMESPACE, name: "" }), { code: "missing-name" });
    for (const customNamespace of ["", "not-a-uuid", "6ba7b8109dad11d180b400c04fd430c8"]) {
      await assert.rejects(execute({ version, namespace: "custom", customNamespace, name: "example" }), (error) => {
        assert.equal(error.code, "invalid-namespace");
        assert.match(error.recovery, /namespace/i);
        return true;
      });
    }
  }
});

test("UUID random and timestamp versions produce distinct values with their selected version and RFC variant", async () => {
  for (const version of ["v1", "v4", "v6", "v7"]) {
    const result = await execute({ version, count: 100 });
    assert.equal(result.render, "list");
    assert.equal(result.downloadName, "uuids.txt");
    assert.equal(result.items.length, 100);
    assert.equal(new Set(result.items).size, 100);
    for (const value of result.items)
      assert.match(
        value,
        new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version[1]}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`),
      );
  }
});

test("UUID quantity respects declared bounds and rejects fractional or invalid direct runtime counts", async () => {
  for (const [count, expected] of [
    [0, 1],
    [101, 100],
    ["3", 3],
  ])
    assert.equal((await execute({ count })).items.length, expected);
  for (const count of [1.5, 0, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(execute({ count }, { raw: true }), { code: "invalid-count" });
  }
  assert.match((await execute({ count: 1, hyphens: false, upper: true })).items[0], /^[0-9A-F]{32}$/);
});

test("UUID executor rejects unsupported direct runtime versions instead of returning another version", async () => {
  for (const version of ["v2", "v8", "unknown"])
    await assert.rejects(execute({ version }, { raw: true }), { code: "unsupported-version" });
});

test("UUID executor respects cancellation before generating any version", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const version of ["v1", "v3", "v4", "v5", "v6", "v7"]) {
    await assert.rejects(
      execute({ version, namespace: DNS_NAMESPACE, name: "example" }, { signal: controller.signal }),
      { name: "AbortError" },
    );
  }
});

test("UUID entropy-based versions reject unavailable secure cryptography without a random fallback", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    for (const version of ["v1", "v4", "v6", "v7"])
      await assert.rejects(execute({ version }), { code: "crypto-unavailable" });
    assert.deepEqual((await execute({ version: "v5", namespace: DNS_NAMESPACE, name: "www.example.com" })).items, [
      VECTORS.v5,
    ]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});
