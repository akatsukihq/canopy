import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("whitespace-remover");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  ["extra", "a b\n\n c", "a b\n\nc"],
  ["all", " a\t b\r\n\u00a0c ", "abc"],
  ["leading", " a  \n\t b ", "a  \nb "],
  ["trailing", " a  \n\t b ", " a\n\t b"],
  ["blank", "a\n \n\tb\n\n", "a\n\tb\n"],
])("whitespace-remover: %s removes only the selected whitespace", async (mode, input, output) => {
  expect(await execute(input, { mode })).toEqual({
    render: "text",
    text: output,
    downloadName: "cleaned-text.txt",
  });
});

test("whitespace-remover: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});
