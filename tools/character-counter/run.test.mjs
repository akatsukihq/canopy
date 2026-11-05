import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("character-counter");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  [true, true, 5],
  [false, true, 4],
  [true, false, 3],
  [false, false, 2],
])(
  "character-counter: spaces=%s lineBreaks=%s count Unicode code points",
  async (includeSpaces, countLineBreaks, count) => {
    const result = await execute("A 😀\r\n", { includeSpaces, countLineBreaks });
    expect(result.text).toBe(`Characters: ${count}\nCharacters without spaces: 2\nWords: 2\nLines: 2\nUTF-8 bytes: 8`);
  },
);

test.each([
  [279, 1],
  [280, 0],
  [281, -1],
])("character-counter: limit280 at %s", async (count, remaining) => {
  expect((await execute("é".repeat(count), { limit280: true })).text).toContain(
    `Characters: ${count} / 280\nRemaining: ${remaining}`,
  );
});

test("character-counter: empty input reports zero counts", async () => {
  const result = await execute();
  expect(result.text).toMatch(/^\w+: 0\n/);
  expect(result.text).toContain("Characters without spaces: 0");
  expect(result.text).toContain("Lines: 0");
});
