import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("sitemap-generator");
import { run } from "./run.ts";
import { setupReactTools, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();
let writeText;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});
const execute = () => click(button("Run test operation"));
async function copied() {
  await click(button("Copy all"));
  return writeText.mock.calls.at(-1)[0];
}

test("sitemap workspace rejects a bad URL, accepts edited input, and copies escaped XML", async () => {
  const view = await mountWorkspace(definition, run, undefined, { text: "/relative" });
  await execute();
  assert.ok(view.container.textContent.includes("Sitemap URL must be an absolute http or https URL."));
  await fill(field("URLs"), "https://example.com/?a=1&b=2\nhttps://example.com/about");
  await execute();
  assert.equal(
    await copied(),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/?a=1&amp;b=2</loc></url>\n  <url><loc>https://example.com/about</loc></url>\n</urlset>',
  );
  assert.ok(button(/^Download/));
});
