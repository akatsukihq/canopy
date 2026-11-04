import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("javascript-formatter");
import { run } from "./run.ts";
import { runInNewContext } from "node:vm";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("javascript-formatter: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test.each([
  ["2", "  "],
  ["4", "    "],
  ["tab", "\t"],
])("javascript-formatter: %s indentation preserves string literals and escapes", async (indentWidth, indent) => {
  expect(await execute('function greet(){return "café 😀; {}";}', { indentWidth })).toEqual({
    render: "text",
    text: `function greet() {\n${indent}return "café 😀; {}";\n}`,
    downloadName: "formatted.js",
  });
});

test("javascript-formatter: unfinished quoted text is rejected and valid retry succeeds", async () => {
  await expect(execute('const x = "unfinished')).rejects.toMatchObject({ code: "invalid-source" });
  expect((await execute("const x = 1;")).text).toContain("const x = 1");
});

test.each([
  [
    "escaped quotes and delimiter characters",
    '(() => { const value = "a\\\"; { \\\\ b"; return value; })()',
    'a"; { \\ b',
  ],
  ["multiline template indentation", "(() => { return `first\n  second\nlast`; })()", "first\n  second\nlast"],
  ["blank lines inside a template", "(() => { return `first\n\n\nlast`; })()", "first\n\n\nlast"],
  ["a significant line break after return", "(() => { return\n42; })()", undefined],
  ["a block following a return line break", "(() => { return\n{ value: 42 }; })()", undefined],
  ["regular-expression delimiters", "(() => { return /[{};]  /.source; })()", "[{};]  "],
  ["nested template interpolation", "(() => { return `first ${`second  ${2 + 3}`} last`; })()", "first second  5 last"],
])("javascript-formatter: preserves the value of %s with every indentation setting", async (_, source, value) => {
  const evaluate = (code) => runInNewContext(code, Object.create(null), { timeout: 100 });
  expect(evaluate(source)).toBe(value);
  for (const indentWidth of ["2", "4", "tab"]) {
    const result = await execute(source, { indentWidth });
    expect(evaluate(result.text)).toBe(value);
  }
});
