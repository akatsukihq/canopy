import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("slug-generator");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test("slug-generator: independent lines preserve non-Latin letters, normalize accents, and omit empty slugs", async () => {
  expect(await execute("  Café smartTools! \r\n\r\n你好 世界\r!!!\n東京 2026")).toEqual({
    render: "text",
    text: "cafe-smart-tools\n你好-世界\n東京-2026",
    downloadName: "slugs.txt",
  });
});

test("slug-generator: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});

test("slug-generator: shared slugs stay identical on a Turkish-locale browser", async () => {
  const lower = String.prototype.toLocaleLowerCase;
  const browserLocale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locale) {
    return lower.call(this, locale ?? "tr");
  });
  try {
    expect((await execute("I LIKE Istanbul\nİstanbul I")).text).toBe("i-like-istanbul\nistanbul-i");
  } finally {
    browserLocale.mockRestore();
  }
});
