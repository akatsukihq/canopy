import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("robots-txt-generator");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
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

test("robots workspace edits Disallow and Allow paths independently and exports exact rules", async () => {
  await mountWorkspace(definition, run, Workspace);
  await choose("User-agent", "Googlebot");
  await fill(field("Disallow paths"), "/private");
  await fill(field("Allow paths"), "/assets");
  await fill(field("Disallow paths"), "/private\n/api");
  assert.equal(field("Allow paths").value, "/assets", "Editing Disallow paths preserves Allow paths");
  await fill(field("Allow paths"), "/assets\n/public");
  assert.equal(field("Disallow paths").value, "/private\n/api", "Editing Allow paths preserves Disallow paths");
  await fill(field("Sitemap URL"), "");
  await fill(field("Crawl delay"), "5");
  await execute();
  const expected =
    "User-agent: Googlebot\nDisallow: /private\nDisallow: /api\nAllow: /assets\nAllow: /public\nCrawl-delay: 5";
  assert.equal(await copied(), expected);
  await click(field("Allow all"));
  assert.equal(field("Disallow paths").value, "/private\n/api", "Allow all preserves the ignored Disallow paths");
  assert.equal(field("Allow paths").value, "/assets\n/public");
  await execute();
  assert.equal(await copied(), "User-agent: Googlebot\nDisallow:\nAllow: /assets\nAllow: /public\nCrawl-delay: 5");
  await click(field("Allow all"));
  assert.equal(field("Disallow paths").value, "/private\n/api");
  await execute();
  assert.equal(await copied(), expected);
});

test("robots workspace identifies malformed paths and allows correction before copying rules", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "private" });
  await execute();
  assert.ok(view.container.textContent.includes("Every path must start with /."));
  const unavailableCopy = button("Copy all");
  assert.equal(unavailableCopy?.disabled, true, "Copy stays disabled until a valid result exists");
  await click(unavailableCopy);
  assert.equal(writeText.mock.calls.length, 0, "Invalid results cannot write to the clipboard");
  await fill(field("Disallow paths"), "/private");
  await execute();
  assert.equal(await copied(), "User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml");
  assert.ok(!view.container.textContent.includes("Every path must start with /."));
});

test("robots workspace generates Allow-only input and recovers from an invalid Allow path", async () => {
  const view = await mountWorkspace(definition, run, Workspace);
  await fill(field("Sitemap URL"), "");
  await fill(field("Allow paths"), "/public");
  await execute();
  assert.equal(await copied(), "User-agent: *\nDisallow:\nAllow: /public");

  await click(field("Allow all"));
  await fill(field("Allow paths"), "assets");
  await execute();
  assert.ok(view.container.textContent.includes("Every path must start with /."));
  const unavailableCopy = button("Copy all");
  assert.equal(unavailableCopy?.disabled, true, "Allow all does not bypass Allow path validation");
  await click(unavailableCopy);
  assert.equal(writeText.mock.calls.length, 1, "An invalid Allow list cannot replace the copied result");

  await fill(field("Allow paths"), "/assets");
  await execute();
  assert.equal(await copied(), "User-agent: *\nDisallow:\nAllow: /assets");
  assert.equal(field("Disallow paths").value, "");
  assert.ok(!view.container.textContent.includes("Every path must start with /."));
});
