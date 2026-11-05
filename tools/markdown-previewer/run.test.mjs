import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("markdown-previewer");
import { run } from "./run.worker.ts";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("markdown-previewer: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test("markdown-previewer: default render and exported filename preserve Unicode and escaped code", async () => {
  const result = await execute("# café 😀\n\n`<script> & x`", { syntaxHighlighting: false });
  expect(result).toEqual({
    render: "html",
    html: "<h1>café 😀</h1>\n<p><code>&lt;script&gt; &amp; x</code></p>\n",
    downloadName: "preview.html",
  });
});

test("markdown-previewer: GFM and CommonMark differ only when extensions are requested", async () => {
  const setting = "previewMode";
  const source = "~~gone~~\n\n| A |\n| - |\n| B |";
  const gfm = await execute(source, { [setting]: "gfm" });
  const common = await execute(source, { [setting]: "commonmark" });
  expect(gfm.html).toContain("<del>gone</del>");
  expect(gfm.html).toContain("<table>");
  expect(common.html).not.toMatch(/<del>|<table>/);
  expect(common.html).toContain("~~gone~~");
});

test("markdown-previewer: safe-link option protects the exported link opener", async () => {
  const setting = "safeLinks";
  expect((await execute("[Example](https://example.test?a=1&b=2)", { [setting]: true })).html).toContain(
    'target="_blank" rel="noopener noreferrer"',
  );
  expect((await execute("[Example](https://example.test)", { [setting]: false })).html).not.toContain("target=");
});

test("markdown-previewer: cancelled jobs do not deliver a result", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(execute("# Cancelled", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("markdown-previewer: highlighting can be deferred or disabled without changing code text", async () => {
  const source = '```js\nconst value = "é";\n```';
  const deferred = await execute(source);
  const plain = await execute(source, { syntaxHighlighting: false, syncScroll: false });
  expect(deferred.deferCodeHighlighting).toBe(true);
  expect(plain.deferCodeHighlighting).toBeUndefined();
  expect(plain.html).toBe(deferred.html);
  expect(plain.html).toContain("const value = &quot;é&quot;;");
});
