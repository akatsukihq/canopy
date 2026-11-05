import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("timestamp-converter");
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

test("timestamp workspace applies explicit units and timezone choices to copied results", async () => {
  const view = await mountWorkspace(definition, run, undefined, { text: "1000" });
  await choose("Input unit", "Milliseconds");
  await choose("Output timezone", "UTC only");
  await execute();
  assert.equal(
    await copied(),
    "ISO: 1970-01-01T00:00:01.000Z\nUTC: Thu, 01 Jan 1970 00:00:01 GMT\nUnix seconds: 1\nUnix milliseconds: 1000",
  );
  await fill(field(/^Timestamp or date/), "invalid");
  await execute();
  assert.ok(view.container.textContent.includes("Timestamp or date is not a valid date or timestamp."));
  await fill(field(/^Timestamp or date/), "1704067200");
  await choose("Input unit", "Seconds");
  await execute();
  assert.ok((await copied()).includes("ISO: 2024-01-01T00:00:00.000Z"));
});
