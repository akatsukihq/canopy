import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test, afterEach, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const randomDefinition = await toolSpec("random-number-generator");
import { run as randomNumbers } from "./run.ts";

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

test("random-number defaults use cryptographic values, include range endpoints and export text", () => {
  let value = 0;
  randomValues(() => (value++ % 2 ? 99 : 0));
  assert.deepEqual(randomNumbers(context(randomDefinition)), {
    render: "list",
    items: ["1", "100", "1", "100", "1", "100", "1", "100", "1", "100"],
    downloadName: "random-numbers.txt",
  });
});

test("random-number seeded output is reproducible and independent of secure randomness", () => {
  vi.stubGlobal("crypto", undefined);
  const ctx = context(randomDefinition, "", {
    min: 10,
    max: 99,
    count: 6,
    seed: "smarttools-2025",
    decimalPlaces: "2",
    uniqueValues: true,
    wholeNumbers: false,
    sortResult: true,
  });
  const result = randomNumbers(ctx);
  assert.deepEqual(result.items, ["23.89", "25.99", "26.76", "37.21", "57.13", "75.07"]);
  assert.deepEqual(randomNumbers(ctx), result);
  assert.notDeepEqual(randomNumbers({ ...ctx, settings: { ...ctx.settings, seed: "different" } }).items, result.items);
});

for (const decimalPlaces of ["1", "2", "3", "4"]) {
  test(`random-number decimal precision ${decimalPlaces} retains trailing zeroes`, () => {
    assert.deepEqual(
      randomNumbers(
        context(randomDefinition, "", {
          min: -1,
          max: -1,
          count: 1,
          seed: "repeat",
          wholeNumbers: false,
          decimalPlaces,
        }),
      ).items,
      [`-1.${"0".repeat(Number(decimalPlaces))}`],
    );
  });
}

test("random-number uniqueness can exhaust a range and sort signed values numerically", () => {
  assert.deepEqual(
    randomNumbers(
      context(randomDefinition, "", {
        min: -2,
        max: 2,
        count: 5,
        seed: "exhaust",
        uniqueValues: true,
        sortResult: true,
      }),
    ).items,
    ["-2", "-1", "0", "1", "2"],
  );
  const ctx = context(randomDefinition, "", { min: -100, max: 100, count: 15, seed: "ordering" });
  const original = randomNumbers(ctx).items;
  const sorted = randomNumbers({ ...ctx, settings: { ...ctx.settings, sortResult: true } }).items;
  assert.deepEqual(
    sorted,
    [...original].sort((a, b) => Number(a) - Number(b)),
  );
  assert.notDeepEqual(sorted, original);
});

test("random-number uniqueness retries collisions without losing requested values or draw order", () => {
  const draws = [2, 2, 0, 0, 1];
  randomValues(() => {
    assert.ok(draws.length > 0, "generation must stop once the requested unique values are available");
    return draws.shift();
  });
  assert.deepEqual(
    randomNumbers(
      context(randomDefinition, "", {
        min: 10,
        max: 12,
        count: 3,
        uniqueValues: true,
      }),
    ).items,
    ["12", "10", "11"],
  );
});

test("random-number count/range boundaries work after settings normalization", () => {
  randomValues(() => 0);
  const ctx = context(randomDefinition, "", { min: -1e9, max: 1e9, count: 1000 });
  assert.equal(randomNumbers(ctx).items.length, 1000);
  assert.equal(randomNumbers(ctx).items[0], "-1000000000");
  assert.equal(randomNumbers(context(randomDefinition, "", { count: 0 })).items.length, 1);
});

for (const [settings, code] of [
  [{ min: 2, max: 1 }, "bounds-inverted"],
  [{ min: 0.5 }, "bounds-not-integers"],
  [{ max: 10.5 }, "bounds-not-integers"],
  [{ min: -1e9, max: 1e9, wholeNumbers: false, decimalPlaces: "4" }, "invalid-random-range"],
  [{ min: 1, max: 2, count: 3, uniqueValues: true }, "not-enough-unique-values"],
]) {
  test(`random-number rejects invalid range ${JSON.stringify(settings)}`, () => {
    assert.throws(() => randomNumbers(context(randomDefinition, "", settings)), { code });
  });
}

test("random-number unseeded generation requires crypto", () => {
  vi.stubGlobal("crypto", undefined);
  assert.throws(() => randomNumbers(context(randomDefinition)), { code: "crypto-unavailable" });
});
