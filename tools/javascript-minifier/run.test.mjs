import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("javascript-minifier");
import { run } from "./run.ts";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("javascript-minifier: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test("javascript-minifier: removes comments, preserves Unicode, and supplies an exact download", async () => {
  expect(await execute('// note\nconst café = "😀"; /* after */\n café;')).toEqual({
    render: "text",
    text: 'const café="😀";café;',
    downloadName: "minified.js",
  });
});

test.each(['const x = "open', "const x = 1; /* open"])(
  "javascript-minifier: unfinished source %j provides recovery guidance",
  async (source) => {
    await expect(execute(source)).rejects.toMatchObject({
      code: "unterminated",
      recovery: expect.stringMatching(/close/i),
    });
  },
);

test.each([
  ["quoted-string whitespace and punctuation", '(() => "hello  world : 😀")()', "hello  world : 😀"],
  ["regex-literal whitespace", "(() => /a  b/.source)()", "a  b"],
  ["regex-literal comment-like characters", "(() => /[/*]/.source)()", "[/*]"],
  ["template-literal whitespace and interpolation", "(() => `hello  world : ${2 + 3}`)()", "hello  world : 5"],
  ["a line break after return", "(() => { function value() { return\n42; } return value(); })()", undefined],
  [
    "a line break before prefix increment",
    '(() => { let x = 1; let y = 2; x\n++y; return [x, y].join(","); })()',
    "1,3",
  ],
  ["postfix-increment value", "(() => { let x = 1; return x++; })()", 1],
  ["separate adjacent operators", "(() => { let x = 1; return x + ++x; })()", 3],
  ["line break inside a removed comment", "(() => { return /*\ncomment*/ 42; })()", undefined],
  ["division beside a regular expression", "(() => 6 / /a/.source.length)()", 6],
  ["nested template interpolation", "(() => `first ${`second  ${2 + 3}`} last`)()", "first second  5 last"],
])("javascript-minifier: preserves the evaluated result of %s", async (_name, source, expected) => {
  // These fixed snippets return primitives and have no I/O. Evaluate both the
  // original and transformed code to test meaning rather than formatting.
  const evaluate = (code) => runInNewContext(code, Object.create(null), { timeout: 1000 });
  expect(evaluate(source)).toBe(expected);
  const result = await execute(source);
  expect(evaluate(result.text)).toBe(expected);
});
