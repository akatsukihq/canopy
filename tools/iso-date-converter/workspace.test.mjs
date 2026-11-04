import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("iso-date-converter");
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

test("ISO workspace controls readable timezone, locale, and source offset independently", async () => {
  await mountWorkspace(definition, run, undefined, { text: "2026-07-22T12:30:00+05:30" });
  await choose("Display timezone", "UTC");
  await choose("Locale", "English (United Kingdom)");
  await click(button("Restore settings panel"));
  await click(field("Show UTC"));
  await execute();
  assert.equal(await copied(), "ISO: 2026-07-22T07:00:00.000Z\nDisplay (UTC): 22/07/2026, 07:00:00\nUnix: 1784703600");
  await click(field("Preserve offset"));
  await execute();
  assert.equal(
    await copied(),
    "ISO: 2026-07-22T12:30:00.000+05:30\nDisplay (UTC): 22/07/2026, 07:00:00\nUnix: 1784703600",
  );
});

test("ISO conversion exposes invalid-date feedback and recovers without reloading the workspace", async () => {
  const view = await mountWorkspace(definition, run, undefined, { text: "not-a-date" });
  await execute();
  assert.ok(view.container.textContent.includes("Date input is not a valid date or timestamp."));
  const unavailableCopy = button("Copy all");
  assert.equal(unavailableCopy?.disabled, true, "Copy stays disabled until a valid result exists");
  await click(unavailableCopy);
  assert.equal(writeText.mock.calls.length, 0, "Invalid results cannot write to the clipboard");
  await fill(field(/^Date or Unix timestamp/), "2024-01-01T00:00:00Z");
  await choose("Display timezone", "UTC");
  await execute();
  assert.equal(
    await copied(),
    "ISO: 2024-01-01T00:00:00.000Z\nUTC: Mon, 01 Jan 2024 00:00:00 GMT\nDisplay (UTC): 1/1/2024, 12:00:00 AM\nUnix: 1704067200",
  );
  assert.ok(!view.container.textContent.includes("Date input is not a valid date or timestamp."));
});
