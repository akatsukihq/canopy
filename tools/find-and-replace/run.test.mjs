import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("find-and-replace");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  [{}, "staging STAGING production", "production STAGING production"],
  [{ find: "a.b", replace: "$&!", ci: true }, "a.b A.B axb", "a.b! A.B! axb"],
  [{ find: "(\\p{L}+)=(\\d+)", replace: "$2:$1", regex: true }, "café=12 中文=3", "12:café 3:中文"],
  [{ find: "word", replace: "", regex: true, ci: true }, "WORD word end", "  end"],
])("find-and-replace: literal and regular-expression replacements %j", async (settings, input, output) => {
  expect(await execute(input, settings)).toEqual({
    render: "text",
    text: output,
    downloadName: "replaced-text.txt",
  });
});

test.each([
  [{ find: "" }, "find-required"],
  [{ find: "[", regex: true }, "pattern-invalid"],
])("find-and-replace: invalid configuration %j has recovery guidance", async (settings, code) => {
  await expect(execute("hello", settings)).rejects.toMatchObject({ code, recovery: expect.any(String) });
  expect((await execute("hello", { find: "hello", replace: "fixed" })).text).toBe("fixed");
});

test("find-and-replace: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});
