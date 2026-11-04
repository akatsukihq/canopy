import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("random-string-generator");
import { run } from "./run.ts";

afterEach(() => vi.unstubAllGlobals());

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  ["alnum", /^[A-Za-z0-9]+$/],
  ["letters", /^[A-Za-z]+$/],
  ["numbers", /^\d+$/],
  ["hex", /^[a-f0-9]+$/],
  ["all", /^[A-Za-z0-9!@#$%^&*()\-_=+]+$/],
])("random-string-generator: %s respects the selected alphabet", async (charset, pattern) => {
  const result = await execute("", { charset });
  expect(result).toMatchObject({ render: "list", downloadName: "random-strings.txt" });
  expect(result.items).toHaveLength(5);
  for (const value of result.items) {
    expect(value).toHaveLength(24);
    expect(value).toMatch(pattern);
  }
});

test("random-string-generator: declared minimum and maximum apply before generation", async () => {
  for (const [settings, count, length] of [
    [{ length: 0, count: -1 }, 1, 1],
    [{ length: 1025, count: 101 }, 100, 1024],
  ]) {
    const result = await execute("", settings);
    expect(result.items).toHaveLength(count);
    for (const value of result.items) expect(value).toHaveLength(length);
  }
});

test("random-string-generator: secure entropy rejects biased values and produces independent batch entries", async () => {
  const values = [0xffff_ffff, 0, 1, 2, 3, 4, 5, 6, 7];
  vi.stubGlobal("crypto", {
    getRandomValues(array) {
      const next = values.shift();
      if (next === undefined) throw new Error("Unexpected entropy request");
      array[0] = next;
      return array;
    },
  });
  expect((await execute("", { charset: "numbers", count: 2, length: 4 })).items).toEqual(["0123", "4567"]);
});

test("random-string-generator: unavailable secure entropy is an error rather than an insecure fallback", async () => {
  vi.stubGlobal("crypto", undefined);
  await expect(execute()).rejects.toMatchObject({ code: "crypto-unavailable" });
});
