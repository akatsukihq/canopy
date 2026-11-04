import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";

import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("lorem-ipsum-generator");
import { run } from "./run.ts";

function generate(settings = {}) {
  return run({
    input: { text: "", secondary: "" },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  [
    "short",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus.",
  ],
  [
    "medium",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus. Praesent commodo sem at augue posuere, non suscipit ipsum viverra.",
  ],
  [
    "long",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus. Praesent commodo sem at augue posuere, non suscipit ipsum viverra. Donec vitae lectus sed neque efficitur consequat.",
  ],
])("%s preserves the existing paragraph text and export", (paragraphLength, text) => {
  expect(generate({ paragraphs: 1, paragraphLength })).toEqual({
    render: "text",
    text,
    downloadName: "lorem-ipsum.txt",
  });
});

test("presets preserve paragraph offsets and the opening and punctuation toggles", () => {
  const result = generate({
    paragraphs: 2,
    paragraphLength: "short",
    startWithLorem: false,
    includePunctuation: false,
  });

  expect(result.text).toBe(
    "Integer feugiat nibh sed velit luctus vitae facilisis justo luctus Praesent commodo sem at augue posuere non suscipit ipsum viverra\n\nPraesent commodo sem at augue posuere non suscipit ipsum viverra Donec vitae lectus sed neque efficitur consequat",
  );
});

test("default generation remains three deterministic medium paragraphs", () => {
  const result = generate();
  expect(result).toEqual(generate({ paragraphs: 3, paragraphLength: "medium" }));
  expect(result.text.split("\n\n")).toHaveLength(3);
  expect(result).toEqual(generate());
});

test("custom size can generate a single sentence in each paragraph", () => {
  expect(generate({ paragraphs: 2, paragraphLength: "custom", customSentences: 1 })).toEqual({
    render: "text",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nInteger feugiat nibh sed velit luctus, vitae facilisis justo luctus.",
    downloadName: "lorem-ipsum.txt",
  });
});

test("custom sentence counts cycle deterministically and retain paragraph offsets", () => {
  const settings = { paragraphs: 2, paragraphLength: "custom", customSentences: 5 };
  const result = generate(settings);

  expect(result.text).toBe(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus. Praesent commodo sem at augue posuere, non suscipit ipsum viverra. Donec vitae lectus sed neque efficitur consequat. Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nInteger feugiat nibh sed velit luctus, vitae facilisis justo luctus. Praesent commodo sem at augue posuere, non suscipit ipsum viverra. Donec vitae lectus sed neque efficitur consequat. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus.",
  );
  expect(result).toEqual(generate(settings));
});

test("custom size respects the classic opening and punctuation toggles", () => {
  const settings = {
    paragraphs: 1,
    paragraphLength: "custom",
    customSentences: 1,
    startWithLorem: false,
  };

  expect(generate(settings).text).toBe("Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus.");
  expect(generate({ ...settings, includePunctuation: false }).text).toBe(
    "Integer feugiat nibh sed velit luctus vitae facilisis justo luctus",
  );
});

test("an omitted or unusable custom sentence count defaults to three", () => {
  const expected = generate({ paragraphs: 1, paragraphLength: "medium" });
  for (const customSentences of [undefined, null, "", "not a number", Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(generate({ paragraphs: 1, paragraphLength: "custom", customSentences })).toEqual(expected);
  }
});

test.each([
  [0, 1],
  [-3, 1],
  [100, 100],
  [101, 100],
  [5.9, 5],
  ["7.8", 7],
])("custom size normalizes %s to %s whole sentences", (customSentences, expectedCount) => {
  const result = generate({ paragraphs: 1, paragraphLength: "custom", customSentences });
  expect(result.text.match(/\./g)).toHaveLength(expectedCount);
  expect(result.text).toMatch(/^[A-Z].*\.$/);
});

test("custom output stays bounded at fifty paragraphs of one hundred sentences", () => {
  const result = generate({ paragraphs: 51, paragraphLength: "custom", customSentences: 101 });
  const paragraphs = result.text.split("\n\n");

  expect(paragraphs).toHaveLength(50);
  for (const paragraph of paragraphs) expect(paragraph.match(/\./g)).toHaveLength(100);
  expect(result.downloadName).toBe("lorem-ipsum.txt");
});

test("a custom count does not change any preset size", () => {
  for (const paragraphLength of ["short", "medium", "long"]) {
    expect(generate({ paragraphs: 2, paragraphLength, customSentences: 99 })).toEqual(
      generate({ paragraphs: 2, paragraphLength }),
    );
  }
});
