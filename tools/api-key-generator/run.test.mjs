import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const apiDefinition = await toolSpec("api-key-generator");
import { run as apiKeys } from "./run.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const randomValues = (next) =>
  vi.stubGlobal("crypto", {
    getRandomValues(values) {
      for (let index = 0; index < values.length; index++) values[index] = next();
      return values;
    },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("API key defaults generate exactly three 32-character bodies and downloadable text", () => {
  randomValues(() => 0);
  assert.deepEqual(apiKeys(context(apiDefinition)), {
    render: "list",
    items: Array(3).fill(`sk_${"A".repeat(32)}`),
    downloadName: "api-keys.txt",
  });
});

for (const [environment, prefix] of [
  ["none", "sk_"],
  ["dev", "sk_dev_"],
  ["test", "sk_test_"],
  ["live", "sk_live_"],
]) {
  test(`API key environment ${environment} has an exact prefix`, () => {
    randomValues(() => 0);
    assert.deepEqual(apiKeys(context(apiDefinition, "", { environment, prefix: " sk ", count: 1, length: 8 })).items, [
      `${prefix}AAAAAAAA`,
    ]);
  });
}

for (const [characterSet, avoidAmbiguous, alphabet] of [
  ["url-safe", false, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"],
  ["alphanumeric", false, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"],
  ["url-safe", true, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_"],
  ["alphanumeric", true, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"],
]) {
  test(`API key ${characterSet}, avoid ambiguous=${avoidAmbiguous} covers every allowed character`, () => {
    let index = 0;
    randomValues(() => index++);
    const result = apiKeys(
      context(apiDefinition, "", { prefix: "", count: 1, length: alphabet.length, characterSet, avoidAmbiguous }),
    );
    assert.deepEqual(result.items, [alphabet]);
  });
}

test("API key empty prefix, environment-only prefix, and 32-character prefix stay valid", () => {
  randomValues(() => 0);
  for (const [prefix, environment, expected] of [
    ["", "none", "AAAAAAAA"],
    ["", "dev", "dev_AAAAAAAA"],
    ["k".repeat(32), "none", `${"k".repeat(32)}_AAAAAAAA`],
  ]) {
    assert.deepEqual(apiKeys(context(apiDefinition, "", { prefix, environment, length: 8, count: 1 })).items, [
      expected,
    ]);
  }
});

for (const [length, count] of [
  [8, 1],
  [256, 100],
]) {
  test(`API key accepts boundary length=${length}, count=${count}`, () => {
    randomValues(() => 0);
    const result = apiKeys(context(apiDefinition, "", { prefix: "", length, count }));
    assert.equal(result.items.length, count);
    assert.ok(result.items.every((item) => item === "A".repeat(length)));
  });
}

test("API key untrusted numeric settings clamp to supported bounds", () => {
  randomValues(() => 0);
  const minimum = apiKeys(context(apiDefinition, "", { prefix: "", length: -1, count: 0 }));
  assert.deepEqual(minimum.items, ["AAAAAAAA"]);
  const maximum = apiKeys(context(apiDefinition, "", { prefix: "", length: 999, count: 999 }));
  assert.equal(maximum.items.length, 100);
  assert.equal(maximum.items[0].length, 256);
});

for (const prefix of ["key with spaces", "key!", "é", "k".repeat(33)]) {
  test(`API key executor rejects invalid prefix ${JSON.stringify(prefix)}`, () => {
    const ctx = context(apiDefinition);
    assert.throws(() => apiKeys({ ...ctx, settings: { ...ctx.settings, prefix } }), { code: "invalid-prefix" });
  });
}

test("API keys fail clearly without secure random support", () => {
  vi.stubGlobal("crypto", undefined);
  assert.throws(() => apiKeys(context(apiDefinition)), { code: "crypto-unavailable" });
});

test("API key random sampling rejects biased values instead of mapping them to a character", () => {
  const samples = [0xffffffff, 61, 0, 0, 0, 0, 0, 0, 0];
  randomValues(() => samples.shift() ?? 0);
  assert.deepEqual(
    apiKeys(context(apiDefinition, "", { prefix: "", characterSet: "alphanumeric", count: 1, length: 8 })).items,
    ["9AAAAAAA"],
  );
});
