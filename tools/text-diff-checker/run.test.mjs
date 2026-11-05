import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("text-diff-checker");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test("text-diff-checker: Unicode edits preserve both source documents and exact export", async () => {
  const result = await execute("café\n😀", {}, "café\n你好");
  expect(result.text).toBe("  café\n- 😀\n+ 你好");
  expect(result.downloadName).toBe("text-diff.txt");
  expect(result.diffPreview.lines).toEqual([
    { kind: "context", text: "café" },
    { kind: "removed", text: "😀" },
    { kind: "added", text: "你好" },
  ]);
});

test("identical text normalizes CRLF and CR while preserving meaningful whitespace", async () => {
  const result = await execute("alpha\r\n\r beta \r\n", {}, "alpha\n\n beta \n");
  expect(result.text).toBe("  alpha\n  \n   beta \n  ");
  expect(result.verdict.label).toBe("No differences");
});

test("an empty changed document exports all removals and retains its empty-line representation", async () => {
  const result = await execute("alpha\nbeta", {}, "");
  expect(result.text).toBe("- alpha\n- beta\n+ ");
  expect(result.verdict.label).toBe("1 line added · 2 lines removed");
});

test("comparison size is accepted at the boundary and rejected just above it with a safe retry", async () => {
  const allowed = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join("\n");
  expect((await execute(allowed, {}, allowed)).verdict.label).toBe("No differences");
  const oversized = `${allowed}\nextra`;
  await expect(execute(oversized, {}, oversized)).rejects.toMatchObject({
    code: "comparison-too-large",
    recovery: "Split the inputs into smaller sections and compare them one at a time.",
  });
  expect((await execute("restored", {}, "restored")).verdict.label).toBe("No differences");
});
