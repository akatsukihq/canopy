import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("text-reverser");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  ["chars", "A😀é", "é😀A"],
  ["words", "  one\t你好\nthree ", "three 你好 one"],
  ["lines", "one\r\ntwo\rthree\n", "\nthree\ntwo\none"],
])("text-reverser: %s reverses the chosen unit with exact downloadable text", async (mode, input, output) => {
  expect(await execute(input, { mode })).toEqual({
    render: "text",
    text: output,
    downloadName: "reversed-text.txt",
  });
});

test("text-reverser: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});
