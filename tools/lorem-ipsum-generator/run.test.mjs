import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("lorem-ipsum-generator");
import { run } from "./run.ts";

function generate(settings) {
  return run({
    input: { text: "", files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test("paragraph bounds clamp to one and fifty without empty trailing paragraphs", () => {
  for (const [requested, count] of [
    [0, 1],
    [-10, 1],
    [50, 50],
    [51, 50],
  ]) {
    const result = generate({ paragraphs: requested, paragraphLength: "custom", customSentences: 1 });
    expect(result.text.split("\n\n")).toHaveLength(count);
    expect(result.text.endsWith("\n")).toBe(false);
    expect(result.downloadName).toBe("lorem-ipsum.txt");
  }
});

test("invalid numeric and select inputs recover to deterministic three-paragraph defaults", () => {
  const defaults = generate({});
  expect(defaults.text.split("\n\n")).toHaveLength(3);
  expect(generate({ paragraphs: "invalid", paragraphLength: "invalid", customSentences: Infinity })).toEqual(defaults);
});

test.each(["short", "medium", "long", "custom"])(
  "%s supports punctuation removal independently of classic opening",
  (paragraphLength) => {
    const result = generate({ paragraphs: 1, paragraphLength, includePunctuation: false, startWithLorem: true });
    expect(result.text).toMatch(/^Lorem ipsum dolor sit amet/);
    expect(result.text).not.toMatch(/[.,]/);
  },
);

test.each([
  ["short", 2],
  ["medium", 3],
  ["long", 4],
  ["custom", 5],
])("%s generates the requested sentence count in every paragraph", (paragraphLength, sentences) => {
  const result = generate({ paragraphs: 2, paragraphLength, customSentences: 5 });
  for (const paragraph of result.text.split("\n\n")) expect(paragraph.match(/\./g)).toHaveLength(sentences);
  expect(result.text.startsWith("Lorem ipsum dolor sit amet, consectetur adipiscing elit.")).toBe(true);
});

test("disabling the classic opening rotates the text without changing paragraph sizes", () => {
  const result = generate({ paragraphs: 2, paragraphLength: "short", startWithLorem: false });
  expect(result.text).toBe(
    "Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus. Praesent commodo sem at augue posuere, non suscipit ipsum viverra.\n\nPraesent commodo sem at augue posuere, non suscipit ipsum viverra. Donec vitae lectus sed neque efficitur consequat.",
  );
});

test.each([
  [0, 1],
  [101, 100],
  [5.9, 5],
  ["7.8", 7],
])("custom sentence bound %j becomes %s whole sentences", (customSentences, count) => {
  expect(generate({ paragraphs: 1, paragraphLength: "custom", customSentences }).text.match(/\./g)).toHaveLength(count);
});
