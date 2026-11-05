import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("duplicate-line-remover");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  [false, false, " Alpha \nAlpha\nalpha\nβ\n"],
  [false, true, "Alpha\nalpha\nβ\n"],
  [true, false, " Alpha \nAlpha\nβ\n"],
  [true, true, "Alpha\nβ\n"],
])("duplicate-line-remover: ci=%s trim=%s retains the first occurrence", async (ci, trim, output) => {
  expect(await execute(" Alpha \r\nAlpha\ralpha\nβ\nβ\n", { ci, trim })).toEqual({
    render: "text",
    text: output,
    downloadName: "unique-lines.txt",
  });
});

test("duplicate-line-remover: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});

test("duplicate-line-remover: case folding is unchanged in a Turkish locale", async () => {
  const lower = String.prototype.toLocaleLowerCase;
  const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locales) {
    return lower.call(this, locales ?? "tr");
  });
  try {
    expect((await execute("I\ni\nı", { ci: true })).text).toBe("I\nı");
  } finally {
    locale.mockRestore();
  }
});
