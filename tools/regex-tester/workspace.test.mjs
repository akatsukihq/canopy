import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("regex-tester");
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

test("regex tester workspace edits both inputs and flags, then recovers from invalid syntax", async () => {
  const view = await mountWorkspace(definition, run, undefined, { text: "(?<word>hello)", secondary: "Hello hello" });
  await click(button("Restore settings panel"));
  await fill(field("Flags"), "gi");
  await execute();
  assert.deepEqual(JSON.parse(await copied()), {
    count: 2,
    matches: [
      { index: 0, match: "Hello", groups: { word: "Hello" } },
      { index: 6, match: "hello", groups: { word: "hello" } },
    ],
  });
  await fill(field(/^Regex pattern/), "[");
  await execute();
  assert.ok(view.container.textContent.includes("Regex pattern is invalid"));
  await fill(field(/^Regex pattern/), "world");
  await fill(field("Test string"), "world");
  await execute();
  assert.equal(JSON.parse(await copied()).matches[0].match, "world");
});
