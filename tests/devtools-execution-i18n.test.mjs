import { toolSpec } from "./helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../lib/tool-framework/settings.ts";
import { formatToolMessage } from "../lib/tool-framework/translations.ts";
import { translateToolResult } from "../lib/tool-framework/result.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: { ...parseSettings(definition.settings, {}), ...settings },
  signal: new AbortController().signal,
});

const invalidCases = [
  ["qr-code-generator", "", {}],
  ["random-number-generator", "", { min: 2, max: 1 }],
  ["regex-generator", "", { preset: "unsupported" }],
  ["regex-tester", "[", {}],
  ["robots-txt-generator", "private", { allowAll: false }],
  ["sitemap-generator", "https://example.com\n".repeat(50_001), {}],
  ["text-case-converter", "text", { target: "unsupported" }],
  ["timestamp-converter", "999999999999999999", { inputUnit: "seconds" }],
  ["unicode-decoder", "\\u{FFFFFF}", {}],
  ["url-decoder", "%G1", {}],
  ["url-query-builder", "https://example.com", {}, "missingequals"],
  ["utm-builder", "", { source: "" }],
  ["utm-builder", "", { parameters: [{ key: "UTM_SOURCE", value: "test" }] }],
  ["utm-builder", "", { parameters: [{ key: "id", value: "" }] }],
  [
    "utm-builder",
    "",
    {
      parameters: [
        { key: "id", value: "1" },
        { key: "ID", value: "2" },
      ],
    },
  ],
  ["uuid-generator", "", { version: "v3", name: "" }],
  ["xml-to-json", "<root></wrong>", {}],
  ["yaml-to-json", "a: [unfinished", {}],
];

for (const [tool, text, settings, secondary] of invalidCases) {
  test(`${tool} exposes localizable error and recovery metadata without changing diagnostics`, async () => {
    const { default: definition } = await import(`../tools/${tool}/definition.ts`);
    const { run } = await import(`../tools/${tool}/run.ts`);
    await assert.rejects(
      async () => run(context(definition, text, settings, secondary)),
      (error) => {
        const { messageRef, recoveryMessage } = error.details;
        assert.equal(formatToolMessage("en", definition.messages[messageRef.key], messageRef.values), error.message);
        if (error.recovery) {
          assert.equal(
            formatToolMessage("en", definition.messages[recoveryMessage.key], recoveryMessage.values),
            error.recovery,
          );
        }
        return true;
      },
    );
  });
}

test("translated diff metadata preserves source, canonical line kinds and exact copy text", async () => {
  const { run } = await import("../tools/text-diff-checker/run.ts");
  const result = run({ input: { text: "before\nunchanged", secondary: "after\nunchanged" }, settings: {} });
  const messages = {
    "textDiff.changed":
      "{added, plural, one {# ligne ajoutée} other {# lignes ajoutées}} · {removed, plural, one {# ligne supprimée} other {# lignes supprimées}}",
    "textDiff.comparison": "Comparaison du texte modifié au texte original.",
    "textDiff.original": "Texte original",
    "textDiff.changedText": "Texte modifié",
  };
  const display = translateToolResult(result, (ref) => formatToolMessage("fr", messages[ref.key], ref.values));
  assert.equal(display.verdict.label, "1 ligne ajoutée · 1 ligne supprimée");
  assert.equal(display.diffPreview.leftLabel, "Texte original");
  assert.equal(display.diffPreview.rightLabel, "Texte modifié");
  assert.equal(display.text, result.text);
  assert.deepEqual(display.diffPreview.lines, result.diffPreview.lines);
  assert.equal(result.diffPreview.leftLabel, "Original text");
});

test("QR alternative text translates without interpreting or changing encoded input or artifact bytes", async () => {
  const definition = await toolSpec("qr-code-generator");
  const { run } = await import("../tools/qr-code-generator/run.ts");
  const content = "https://example.com/?value={name}";
  const result = await run(context(definition, content));
  const display = translateToolResult(result, (ref) =>
    formatToolMessage("fr", "Code QR contenant {content}", ref.values),
  );
  assert.equal(display.alt, `Code QR contenant ${content}`);
  assert.equal(result.alt, `QR code encoding ${content}`);
  assert.equal(display.src, result.src);
  assert.deepEqual(display.artifacts, result.artifacts);
});
