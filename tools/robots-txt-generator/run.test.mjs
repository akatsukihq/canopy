import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const robotsDefinition = await toolSpec("robots-txt-generator");
import { run as robots } from "./run.ts";
import { readFile } from "node:fs/promises";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const fixture = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixture.cases) {
  test(`robots-txt-generator: reviewed example ${example.name}`, () => {
    const result = robots(context(robotsDefinition, example.input.primary, example.settings, example.input.secondary));
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.downloadName, example.expected.downloadName);
  });
}

for (const userAgent of ["*", "Googlebot", "Bingbot", "DuckDuckBot"]) {
  test(`robots ${userAgent} emits independent Disallow and Allow rules for trimmed paths`, () => {
    assert.equal(
      robots(
        context(robotsDefinition, " /private \r\n\r\n /api ", {
          userAgent,
          sitemap: "",
          allowPaths: " /public \r\n\r\n /assets ",
          crawlDelay: 5,
        }),
      ).text,
      `User-agent: ${userAgent}\nDisallow: /private\nDisallow: /api\nAllow: /public\nAllow: /assets\nCrawl-delay: 5`,
    );
  });
}

test("robots allow-all ignores blocked paths and an empty input allows crawling", () => {
  const expected = "User-agent: *\nDisallow:";
  assert.equal(robots(context(robotsDefinition, "", { sitemap: "" })).text, expected);
  assert.equal(robots(context(robotsDefinition, "ignored non-path", { sitemap: "", allowAll: true })).text, expected);
  assert.equal(
    robots(context(robotsDefinition, "ignored non-path", { sitemap: "", allowAll: true, allowPaths: "/assets" })).text,
    `${expected}\nAllow: /assets`,
  );
  assert.equal(
    robots(context(robotsDefinition, "/", { sitemap: "", crawlDelay: 86400 })).text,
    "User-agent: *\nDisallow: /\nCrawl-delay: 86400",
  );
});

for (const [text, settings, code] of [
  ["admin", {}, "path-root-required"],
  ["/", { allowPaths: "public" }, "path-root-required"],
  ["ignored non-path", { allowAll: true, allowPaths: "public" }, "path-root-required"],
  ["/", { sitemap: "ftp://example.com/sitemap.xml" }, "invalid-url"],
]) {
  test(`robots rejects invalid paths or sitemap ${JSON.stringify([text, settings])}`, () => {
    assert.throws(() => robots(context(robotsDefinition, text, settings)), { code });
  });
}
