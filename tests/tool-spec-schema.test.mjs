import { expect, test } from "vitest";

import { parseToolSpec } from "../lib/tool-framework/specSchema.ts";
import { allToolSpecs } from "./helpers/toolSpec.mjs";

const valid = {
  toolId: "devtools.sample-tool",
  app: "devtools",
  category: "json-tools",
  keywords: [],
  name: "Sample",
  description: "Sample tool.",
  input: { kind: "text", label: "Input" },
  settings: {
    fields: {
      mode: { kind: "select", label: "Mode", default: "a", choices: [{ label: "A", value: "a" }] },
      size: { kind: "number", label: "Size", default: 2, min: 1, max: 4, visibleWhen: { key: "mode", equals: "a" } },
    },
  },
  trigger: { mode: "live" },
  labels: { empty: "Empty", ready: "Ready", running: "Running" },
  content: { howToUse: ["Paste."], examples: [{ label: "One", text: "x", settings: { mode: "a" } }] },
};

const issuesOf = (changes) => {
  const result = parseToolSpec({ ...valid, ...changes });
  return result.ok ? [] : result.issues;
};

test("every stored spec is valid", async () => {
  const failures = (await allToolSpecs()).flatMap((spec) => {
    const result = parseToolSpec(spec);
    return result.ok ? [] : [`${spec.toolId}: ${result.issues.join("; ")}`];
  });
  expect(failures).toEqual([]);
});

test("a valid spec parses with its field order intact", () => {
  const result = parseToolSpec(valid);
  expect(result.ok).toBe(true);
  expect(Object.keys(result.spec.settings.fields)).toEqual(["mode", "size"]);
});

test("unknown keys, wrong kinds and missing labels are reported with their paths", () => {
  expect(issuesOf({ nmae: "typo" }).join()).toContain("nmae");
  expect(issuesOf({ input: { kind: "video", label: "x" } }).join()).toMatch(/^input/);
  expect(issuesOf({ labels: { empty: "", ready: "r", running: "r" } }).join()).toContain("labels.empty");
});

test("cross-field rules catch broken references and defaults", () => {
  expect(issuesOf({ app: "media" })).toContain('app: must match the toolId prefix "devtools"');
  expect(issuesOf({ toolId: "media.sample", app: "media" }).join()).toContain("category");
  const fields = (overrides) => ({ settings: { fields: { ...valid.settings.fields, ...overrides } } });
  expect(issuesOf(fields({ mode: { ...valid.settings.fields.mode, default: "z" } })).join()).toContain(
    "not one of its choices",
  );
  expect(issuesOf(fields({ size: { ...valid.settings.fields.size, default: 9 } })).join()).toContain(
    "between min and max",
  );
  expect(
    issuesOf(fields({ size: { ...valid.settings.fields.size, visibleWhen: { key: "gone", equals: 1 } } })).join(),
  ).toContain('"gone" is not a setting');
  expect(
    issuesOf({ content: { howToUse: [], examples: [{ label: "x", text: "", settings: { nope: 1 } }] } }).join(),
  ).toContain("examples.0.settings.nope");
});

test("non-objects are rejected without throwing", () => {
  for (const value of [null, "spec", 3, []]) expect(parseToolSpec(value).ok).toBe(false);
});
