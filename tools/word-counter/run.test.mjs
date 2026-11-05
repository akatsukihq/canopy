import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("word-counter");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test("word-counter: default options and every counting toggle change the visible count", async () => {
  const input = "state-of-the-art 2026 a@example.com hello";
  expect((await execute(input)).text).toMatch(/^Words: 3\n/);
  expect((await execute(input, { countHyphenated: false })).text).toMatch(/^Words: 6\n/);
  expect((await execute(input, { ignoreNumbers: true })).text).toMatch(/^Words: 2\n/);
  expect((await execute(input, { excludeEmails: false })).text).toMatch(/^Words: 4\n/);
  expect((await execute(input, { estimateReadingTime: false })).text).not.toContain("Reading time");
  expect((await execute("你好 😀")).text).toContain("Characters: 4\nCharacters without spaces: 3");
});

test.each([
  [199, "60 seconds"],
  [200, "1 minute"],
  [201, "2 minutes"],
])("word-counter: reading-time boundary at %s words", async (count, duration) => {
  expect((await execute(Array(count).fill("a").join(" "))).text).toContain(`Reading time: ${duration}`);
});

test("word-counter: empty input reports zero counts", async () => {
  const result = await execute();
  expect(result.text).toMatch(/^\w+: 0\n/);
  expect(result.text).toContain("Characters without spaces: 0");
  expect(result.text).toContain("Lines: 0");
});
