import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const testerDefinition = await toolSpec("regex-tester");
import { run as testRegex } from "./run.ts";
import { readFile } from "node:fs/promises";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixture.cases) {
  test(`regex-tester: reviewed example ${example.name}`, () => {
    const result = testRegex(
      context(testerDefinition, example.input.primary, example.settings, example.input.secondary),
    );
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

for (const [flags, pattern, subject, matches] of [
  [
    "",
    "a",
    "a a",
    [
      { index: 0, match: "a", groups: null },
      { index: 2, match: "a", groups: null },
    ],
  ],
  ["g", "a", "abc", [{ index: 0, match: "a", groups: null }]],
  ["i", "a", "A", [{ index: 0, match: "A", groups: null }]],
  ["m", "^a", "x\na", [{ index: 2, match: "a", groups: null }]],
  ["s", "a.b", "a\nb", [{ index: 0, match: "a\nb", groups: null }]],
  ["u", "\\u{1F600}", "😀", [{ index: 0, match: "😀", groups: null }]],
  ["v", "[\\p{ASCII}&&\\p{Letter}]", "1aé", [{ index: 1, match: "a", groups: null }]],
  ["y", "a", "a a", [{ index: 0, match: "a", groups: null }]],
  ["d", "(?<word>a)", "a", [{ index: 0, match: "a", groups: { word: "a" } }]],
]) {
  test(`regex-tester handles ${flags || "implicit global"} flags and exact indices/groups`, () => {
    assert.deepEqual(JSON.parse(testRegex(context(testerDefinition, pattern, { flags }, subject)).text), {
      count: matches.length,
      matches,
    });
  });
}

test("regex-tester returns zero matches and advances empty matches", () => {
  assert.deepEqual(JSON.parse(testRegex(context(testerDefinition, "a", {}, "")).text), { count: 0, matches: [] });
  assert.deepEqual(JSON.parse(testRegex(context(testerDefinition, "(?=a)", {}, "aa")).text), {
    count: 2,
    matches: [
      { index: 0, match: "", groups: null },
      { index: 1, match: "", groups: null },
    ],
  });
});

test("regex-tester advances zero-width Unicode matches by a whole code point", () => {
  const result = testRegex(context(testerDefinition, "(?=.)", { flags: "u" }, "😀"));
  assert.deepEqual(JSON.parse(result.text), { count: 1, matches: [{ index: 0, match: "", groups: null }] });
});

test.each([
  ["u", "😀a😀", [0, 2, 3, 5]],
  ["v", "😀a😀", [0, 2, 3, 5]],
  ["", "😀", [0, 1, 2]],
  ["u", "\uD83Da\uDE00", [0, 1, 2, 3]],
])("regex-tester advances empty matches correctly with %j flags and %j", (flags, subject, indices) => {
  const result = testRegex(context(testerDefinition, "(?:)", { flags }, subject));
  assert.deepEqual(JSON.parse(result.text), {
    count: indices.length,
    matches: indices.map((index) => ({ index, match: "", groups: null })),
  });
});

for (const [pattern, flags, code] of [
  ["", "g", "invalid-pattern"],
  ["[", "g", "invalid-pattern"],
  ["a", "gg", "invalid-flags"],
  ["a", "x", "invalid-flags"],
  ["a", "uv", "conflicting-flags"],
]) {
  test(`regex-tester rejects pattern=${JSON.stringify(pattern)}, flags=${flags}`, () => {
    assert.throws(() => testRegex(context(testerDefinition, pattern, { flags }, "abc")), { code });
  });
}

test("regex-tester enforces the match limit with an actionable error", () => {
  assert.equal(JSON.parse(testRegex(context(testerDefinition, "a", {}, "a".repeat(9999))).text).count, 9999);
  assert.throws(() => testRegex(context(testerDefinition, "a", {}, "a".repeat(10000))), { code: "too-many-matches" });
});
