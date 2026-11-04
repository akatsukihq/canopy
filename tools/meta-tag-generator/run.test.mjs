import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const metaDefinition = await toolSpec("meta-tag-generator");
import { run as metaTags } from "./run.ts";
import { readFile } from "node:fs/promises";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixture.cases) {
  test(`meta-tag-generator: reviewed example ${example.name}`, () => {
    const result = metaTags(context(metaDefinition, example.input.primary, example.settings, example.input.secondary));
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

test("meta tags escape source text/attributes and omit all disabled or empty optional tags", () => {
  const result = metaTags(
    context(
      metaDefinition,
      '<A & "B">',
      {
        keywords: "",
        author: "",
        canonical: "",
        image: "",
        includeOpenGraph: false,
        includeTwitterCard: false,
        addViewport: false,
      },
      "'C' > D",
    ),
  );
  assert.equal(
    result.text,
    '<title>&lt;A &amp; &quot;B&quot;&gt;</title>\n<meta name="description" content="&#39;C&#39; &gt; D">',
  );
  assert.equal(result.downloadName, "meta-tags.html");
});

for (const locale of ["none", "en_US", "en_GB", "fr_FR", "de_DE", "es_ES"]) {
  test(`meta tags emit selected content locale ${locale} only with Open Graph`, () => {
    const ctx = context(metaDefinition, "Title", { locale }, "Description");
    const expected = locale === "none" ? [] : [`<meta property="og:locale" content="${locale}">`];
    assert.deepEqual(
      metaTags(ctx)
        .text.split("\n")
        .filter((line) => line.includes("og:locale")),
      expected,
    );
    assert.ok(!metaTags({ ...ctx, settings: { ...ctx.settings, includeOpenGraph: false } }).text.includes("og:locale"));
  });
}

for (const [robotsSetting, expected] of [
  ["none", null],
  ["index_follow", "index, follow"],
  ["noindex_follow", "noindex, follow"],
  ["index_nofollow", "index, nofollow"],
  ["noindex_nofollow", "noindex, nofollow"],
]) {
  test(`meta tags robots ${robotsSetting} has the exact directive`, () => {
    const result = metaTags(context(metaDefinition, "Title", { robots: robotsSetting }, "Description"));
    assert.deepEqual(
      result.text.split("\n").filter((line) => line.includes('name="robots"')),
      expected ? [`<meta name="robots" content="${expected}">`] : [],
    );
  });
}

test("meta tags enable Twitter and viewport independently without an optional image", () => {
  const result = metaTags(
    context(
      metaDefinition,
      "Title",
      {
        keywords: "",
        author: "",
        canonical: "",
        image: "",
        includeOpenGraph: false,
        includeTwitterCard: true,
        addViewport: true,
      },
      "Description",
    ),
  );
  assert.equal(
    result.text,
    '<title>Title</title>\n<meta name="description" content="Description">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="Title">\n<meta name="twitter:description" content="Description">',
  );
});

for (const [text, secondary, settings, code] of [
  ["", "Description", {}, "input-required"],
  ["Title", "", {}, "input-required"],
  ["Title", "Description", { canonical: "/relative" }, "invalid-url"],
  ["Title", "Description", { image: "javascript:alert(1)" }, "invalid-url"],
]) {
  test(`meta tags reject missing content and unsafe URLs ${JSON.stringify([text, secondary, settings])}`, () => {
    assert.throws(() => metaTags(context(metaDefinition, text, settings, secondary)), { code });
  });
}
