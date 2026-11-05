import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const regexDefinition = await toolSpec("regex-generator");
import { run as generateRegex } from "./run.ts";
import { readFile } from "node:fs/promises";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixture.cases) {
  test(`regex-generator: reviewed example ${example.name}`, () => {
    const result = generateRegex(
      context(regexDefinition, example.input.primary, example.settings, example.input.secondary),
    );
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

for (const [preset, accepted, rejected] of [
  ["email", "ada@example.com", "not-an-email"],
  ["url", "https://example.com/path?q=1", "ftp://example.com"],
  ["ipv4", "255.0.10.99", "256.0.10.99"],
  ["uuid", "123e4567-e89b-42d3-a456-426614174000", "123e4567-e89b-02d3-a456-426614174000"],
  ["hex-color", "#ff00aa80", "#ggg"],
  ["password", "StrongPass12!", "weak"],
]) {
  test(`regex-generator ${preset} accepts and rejects real complete values`, () => {
    const result = generateRegex(context(regexDefinition, "", { preset }));
    const body = result.text.slice(1, result.text.lastIndexOf("/"));
    const expression = new RegExp(`^(?:${body})$`);
    assert.equal(expression.test(accepted), true);
    assert.equal(expression.test(rejected), false);
  });
}

for (const [flags, suffix] of [
  ["none", ""],
  ["global", "g"],
  ["ignore-case", "i"],
  ["global-ignore-case", "gi"],
]) {
  test(`regex-generator JavaScript ${flags} and multiline flags are exact`, () => {
    assert.equal(
      generateRegex(context(regexDefinition, "", { preset: "hex-color", flags })).text,
      `/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/${suffix}`,
    );
    assert.equal(
      generateRegex(context(regexDefinition, "", { preset: "hex-color", flags, multiline: true })).text,
      `/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/${suffix}m`,
    );
  });
}

for (const [language, expected] of [
  [
    "javascript",
    "// Matches a three, six, or eight-digit hex color.\n/(?<match>#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b)/gim",
  ],
  [
    "python",
    '# Matches a three, six, or eight-digit hex color.\nre.findall(r"(?im:(?P<match>#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b))", text)',
  ],
  [
    "php",
    '// Matches a three, six, or eight-digit hex color.\npreg_match_all("~(?<match>#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b)~im", $text, $matches)',
  ],
]) {
  test(`regex-generator ${language} supports groups, explanation, global, ignore-case, and multiline`, () => {
    assert.equal(
      generateRegex(
        context(regexDefinition, "", {
          preset: "hex-color",
          language,
          flags: "global-ignore-case",
          addNamedGroups: true,
          multiline: true,
          explain: true,
        }),
      ).text,
      expected,
    );
  });
}

test("regex-generator single-match Python and PHP syntax keeps literal delimiters escaped", () => {
  assert.equal(
    generateRegex(context(regexDefinition, "", { preset: "hex-color", language: "python", flags: "ignore-case" })).text,
    'r"(?i:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b)"',
  );
  const php = generateRegex(context(regexDefinition, "", { preset: "email", language: "php" })).text;
  assert.ok(php.startsWith("~[A-Za-z0-9.!#$%&'*+/=?^_`{|}\\~-]"));
  assert.ok(php.endsWith("~"));
});

test("regex-generator rejects an unsupported preset at the executor boundary", () => {
  const ctx = context(regexDefinition);
  assert.throws(() => generateRegex({ ...ctx, settings: { ...ctx.settings, preset: "unknown" } }), {
    code: "preset-invalid",
  });
});
