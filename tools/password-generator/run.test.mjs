import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("password-generator");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

afterEach(() => vi.unstubAllGlobals());

test("password-generator: defaults and numeric bounds control count, length, and filename", async () => {
  const defaults = await execute();
  expect(defaults).toMatchObject({ render: "list", downloadName: "passwords.txt" });
  expect(defaults.items).toHaveLength(4);
  for (const value of defaults.items) expect(value).toHaveLength(16);
  for (const [settings, count, length] of [
    [{ count: 0, length: 0 }, 1, 8],
    [{ count: 101, length: 129 }, 100, 128],
  ]) {
    const result = await execute("", settings);
    expect(result.items).toHaveLength(count);
    for (const value of result.items) expect(value).toHaveLength(length);
  }
});

test.each([
  ["upper", /^[A-Z]+$/],
  ["lower", /^[a-z]+$/],
  ["numbers", /^\d+$/],
  ["symbols", /^[!@#$%^&*()\-_=+\[\]{}]+$/],
])("password-generator: only %s characters are generated", async (group, pattern) => {
  const result = await execute("", { upper: false, lower: false, numbers: false, symbols: false, [group]: true });
  for (const value of result.items) expect(value).toMatch(pattern);
});

test("password-generator: excluding ambiguous characters cannot emit 0, O, I or l", async () => {
  // Enumerate alphabet positions deterministically instead of trusting random sampling.
  let value = 0;
  vi.stubGlobal("crypto", {
    getRandomValues(array) {
      array[0] = value++;
      return array;
    },
  });
  const result = await execute("", { length: 128, count: 1, excludeAmbiguous: true });
  expect(result.items[0]).not.toMatch(/[0OIl]/);
  expect(result.items[0]).toContain("ABC");
  await expect(execute("", { upper: false, lower: false, numbers: false, symbols: false })).rejects.toMatchObject({
    code: "missing-character-group",
  });
});

test("password-generator: unavailable secure entropy is an error rather than an insecure fallback", async () => {
  vi.stubGlobal("crypto", undefined);
  await expect(execute()).rejects.toMatchObject({ code: "crypto-unavailable" });
});
