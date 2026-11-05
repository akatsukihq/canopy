import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("duplicate-word-remover");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test("duplicate-word-remover: case-insensitive duplicates preserve first spelling and punctuation distinctions", async () => {
  expect(await execute("  Café\tCAFÉ café!  你好 你好\nworld WORLD  ")).toEqual({
    render: "text",
    text: "Café café! 你好 world",
  });
});

test("duplicate-word-remover: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});

test("duplicate-word-remover: case folding is unchanged in a Turkish locale", async () => {
  const lower = String.prototype.toLocaleLowerCase;
  const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locales) {
    return lower.call(this, locales ?? "tr");
  });
  try {
    expect((await execute("I i ı")).text).toBe("I ı");
  } finally {
    locale.mockRestore();
  }
});
