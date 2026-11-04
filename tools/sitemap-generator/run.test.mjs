import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const sitemapDefinition = await toolSpec("sitemap-generator");
import { run as sitemap } from "./run.ts";
import { readFile } from "node:fs/promises";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixture.cases) {
  test(`sitemap-generator: reviewed example ${example.name}`, () => {
    const result = sitemap(
      context(sitemapDefinition, example.input.primary, example.settings, example.input.secondary),
    );
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

test("sitemap trims and deduplicates input and XML-escapes query strings", () => {
  assert.deepEqual(
    sitemap(
      context(
        sitemapDefinition,
        " https://example.com/?a=1&b=2 \r\n\r\nhttps://example.com/?a=1&b=2\nhttp://example.org",
      ),
    ),
    {
      render: "text",
      downloadName: "sitemap.xml",
      text: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/?a=1&amp;b=2</loc></url>\n  <url><loc>http://example.org/</loc></url>\n</urlset>',
    },
  );
});

for (const input of ["", " \n ", "/relative", "javascript:alert(1)", "https://valid.com\ninvalid"])
  test(`sitemap rejects unusable URL input ${JSON.stringify(input)}`, () =>
    assert.throws(() => sitemap(context(sitemapDefinition, input))));

test("sitemap accepts 50,000 URLs and rejects 50,001 before producing a partial artifact", () => {
  const input = Array.from({ length: 50000 }, (_, index) => `https://example.com/${index}`).join("\n");
  assert.equal((sitemap(context(sitemapDefinition, input)).text.match(/<url>/g) ?? []).length, 50000);
  assert.throws(() => sitemap(context(sitemapDefinition, `${input}\nhttps://example.com/extra`)), {
    code: "too-many-urls",
  });
});
