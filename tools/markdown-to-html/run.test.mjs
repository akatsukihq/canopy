import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("markdown-to-html");
import { run } from "./run.ts";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("markdown-to-html: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test("markdown-to-html: default render and exported filename preserve Unicode and escaped code", async () => {
  const result = await execute("# café 😀\n\n`<script> & x`", { syntaxHighlighting: false });
  expect(result).toEqual({
    render: "html",
    html: "<h1>café 😀</h1>\n<p><code>&lt;script&gt; &amp; x</code></p>\n",
    downloadName: "converted.html",
  });
});

test("markdown-to-html: GFM and CommonMark differ only when extensions are requested", async () => {
  const setting = "markdownFlavor";
  const source = "~~gone~~\n\n| A |\n| - |\n| B |";
  const gfm = await execute(source, { [setting]: "gfm" });
  const common = await execute(source, { [setting]: "commonmark" });
  expect(gfm.html).toContain("<del>gone</del>");
  expect(gfm.html).toContain("<table>");
  expect(common.html).not.toMatch(/<del>|<table>/);
  expect(common.html).toContain("~~gone~~");
});

test("markdown-to-html: safe-link option protects the exported link opener", async () => {
  const setting = "openLinksSafely";
  expect((await execute("[Example](https://example.test?a=1&b=2)", { [setting]: true })).html).toContain(
    'target="_blank" rel="noopener noreferrer"',
  );
  expect((await execute("[Example](https://example.test)", { [setting]: false })).html).not.toContain("target=");
});

test.each([
  "javascript:alert%281%29",
  "data:text/html,test",
  "javascript&#58;alert%281%29",
  "jav&#x61;script:alert%281%29",
  "file:///etc/passwd",
])("markdown-to-html: sanitizer removes unsafe target %s but retains readable labels", async (url) => {
  const result = await execute(`[Readable](${url})\n\n![Image label](${url})`, { sanitizeHtml: true });
  expect(result.html).not.toMatch(/<a\b|<img\b/);
  expect(result.html).toContain("Readable");
  expect(result.html).toContain("Image label");
});

test("markdown-to-html: sanitizer removes raw HTML while safe links and code remain available", async () => {
  const source = "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Safe](/docs)\n\n`<img onerror=x>`";
  const clean = await execute(source, { sanitizeHtml: true, openLinksSafely: true });
  expect(clean.html).not.toMatch(/<script|<img/i);
  expect(clean.html).toContain('href="/docs" target="_blank" rel="noopener noreferrer"');
  expect(clean.html).toContain("&lt;img onerror=x&gt;");
  expect((await execute("<b>Raw</b>", { sanitizeHtml: false })).html).toContain("<b>Raw</b>");
});

test("markdown-to-html: cancelled jobs do not deliver a result", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(execute("# Cancelled", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
