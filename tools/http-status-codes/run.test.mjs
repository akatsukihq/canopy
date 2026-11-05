import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("http-status-codes");
import { run } from "./run.ts";

test("phrase matching is unchanged in a Turkish browser locale", async () => {
  const lower = String.prototype.toLocaleLowerCase;
  const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locales) {
    return lower.call(this, locales ?? "tr");
  });
  try {
    const result = await run({
      input: { text: "internal", files: [] },
      settings: parseSettings(definition.settings, { searchMode: "phrase-only" }),
      signal: new AbortController().signal,
    });
    expect(result.text).toBe("500 Internal Server Error");
  } finally {
    locale.mockRestore();
  }
});
