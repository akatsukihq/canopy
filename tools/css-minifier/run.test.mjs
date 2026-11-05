import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("css-minifier");
import { run } from "./run.ts";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("css-minifier: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test("css-minifier: default output, rule merging, and color normalization can be selected independently", async () => {
  const source = "/* note */ .a { color: #aabbcc; } .b { color: #aabbcc; }";
  expect(await execute(source)).toEqual({
    render: "text",
    text: ".a{color:#aabbcc}.b{color:#aabbcc}",
    downloadName: "minified.css",
  });
  expect((await execute(source, { mergeRules: true })).text).toBe(".a,.b{color:#aabbcc}");
  expect((await execute(source, { normalizeColors: true })).text).toBe(".a{color:#abc}.b{color:#abc}");
  expect((await execute(source, { normalizeColors: true, mergeRules: true })).text).toBe(".a,.b{color:#abc}");
});

test.each([
  ["modern", "#11223380"],
  ["legacy", "rgba(17,34,51,0.502)"],
])("css-minifier: %s alpha color compatibility", async (browserCompatibility, color) => {
  expect((await execute(".a{color:#11223380}", { browserCompatibility })).text).toBe(`.a{color:${color}}`);
});

test("css-minifier: quoted content must preserve whitespace and comment-like text", async () => {
  const result = await execute('.a::before { content: "hello  world /* text */ : 😀"; }');
  expect(result.text).toContain('"hello  world /* text */ : 😀"');
});

test("css-minifier: math keeps required plus spacing while selector combinators compact", async () => {
  const result = await execute(".a + .b { width: calc(100% + 2px); padding: clamp(1px, calc(2px + 3px), 9px); }");
  expect(result.text).toBe(".a+.b{width:calc(100% + 2px);padding:clamp(1px,calc(2px + 3px),9px)}");
});
