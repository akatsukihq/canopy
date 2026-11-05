import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("url-query-builder");
import { run } from "./run.ts";
import { parseQueryRows } from "./parameters.ts";

const context = (text = "https://example.com/search", secondary = "", settings = {}) => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});
const rowError = {
  code: "invalid-query-row",
  message: "Each query row must use key=value format.",
  recovery: "Give every non-blank line a key, an equals sign, and a value.",
};

const fixtures = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixtures.cases) {
  test(`URL query builder preserves ${example.name}`, () => {
    const result = run(context(example.input.primary, example.input.secondary, example.settings));
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

test("URL query builder appends both inputs in order while preserving existing query and hash", () => {
  const result = run(
    context(
      "https://example.com/search?tag=base&keep=one%20two#section",
      " tag = first \r\n token = a=b=c \r blank= \n tag=second",
      {
        parameters: [
          { key: " tag ", value: " third " },
          { key: " q ", value: "a&b /雪?+" },
          { key: " ", value: " " },
        ],
      },
    ),
  );
  assert.equal(
    result.text,
    "https://example.com/search?tag=base&keep=one+two&tag=first&token=a%3Db%3Dc&blank=&tag=second&tag=third&q=a%26b+%2F%E9%9B%AA%3F%2B#section",
  );
});

test("URL query builder leaves appended values raw when encoding is disabled", () => {
  const result = run(
    context("https://example.com/search?encoded=a%20b&tag=base#frag", "new key=a=b /雪?+\ntag=second", {
      encodeValues: false,
    }),
  );
  assert.equal(result.text, "https://example.com/search?encoded=a+b&tag=base&new+key=a=b /雪?+&tag=second#frag");
});

for (const encodeValues of [true, false]) {
  test(`URL query builder sorts keys stably with encoding ${encodeValues ? "on" : "off"}`, () => {
    const result = run(
      context("https://example.com/search?tag=base&z=last#fragment", "b=2\ntag=first\na=1", {
        encodeValues,
        sortParameters: true,
        parameters: [{ key: "tag", value: "second" }],
      }),
    );
    assert.equal(result.text, "https://example.com/search?a=1&b=2&tag=base&tag=first&tag=second&z=last#fragment");
  });
}

for (const skipEmptyRows of [false, true]) {
  test(`URL query builder ${skipEmptyRows ? "omits" : "keeps"} empty appended values without changing existing ones`, () => {
    const result = run(
      context("https://example.com/?existing=&keep=yes", "empty= \n\npresent=0", {
        skipEmptyRows,
        parameters: [
          { key: "optional", value: " " },
          { key: "truth", value: "false" },
        ],
      }),
    );
    assert.equal(
      result.text,
      skipEmptyRows
        ? "https://example.com/?existing=&keep=yes&present=0&truth=false"
        : "https://example.com/?existing=&keep=yes&empty=&present=0&optional=&truth=false",
    );
  });
}

test("URL query builder permits no rows and preserves the base query and fragment", () => {
  assert.equal(run(context("https://example.com?x=1#top", " \r\n\t\r")).text, "https://example.com/?x=1#top");
});

test("URL query builder rejects malformed bulk rows including whitespace-only keys", () => {
  for (const secondary of ["missing-equals", "=value", "   =value", " \t = ", "ok=yes\ninvalid"]) {
    assert.throws(() => run(context(undefined, secondary)), rowError);
  }
});

test("URL query builder preserves rejection of a settings row with a value but no key", () => {
  assert.throws(() => run(context(undefined, "", { parameters: [{ key: " ", value: "content" }] })), rowError);
});

test("URL query builder preserves base URL validation", () => {
  assert.throws(() => run(context("")), { code: "input-required" });
  for (const url of ["/relative", "ftp://example.com/file", "not a URL"]) {
    assert.throws(() => run(context(url)), { code: "invalid-url" });
  }
});

test("query-row parser preserves repeated keys and equals signs inside trimmed values", () => {
  assert.deepEqual(parseQueryRows(" tag = first \r\ntag=second\rtoken=a=b=c\n spaced key = spaced value "), [
    { key: "tag", value: "first" },
    { key: "tag", value: "second" },
    { key: "token", value: "a=b=c" },
    { key: "spaced key", value: "spaced value" },
  ]);
});

test("query-row parser skips blank lines but keeps explicitly empty values", () => {
  assert.deepEqual(parseQueryRows("\n\r\n\t\r"), []);
  assert.deepEqual(parseQueryRows("empty= \n\t\nother ="), [
    { key: "empty", value: "" },
    { key: "other", value: "" },
  ]);
});

test("query-row parser returns the established error for malformed lines", () => {
  for (const text of ["not-a-pair", "=", "=value", " \t =value", "good=value\nbad"]) {
    assert.throws(() => parseQueryRows(text), rowError);
  }
});
