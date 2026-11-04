import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("date-difference");
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

test("date difference workspace combines direct date/time inputs and the duration switch", async () => {
  await mountWorkspace(definition, run, undefined, { text: "2024-01-01", secondary: "2024-01-01" });
  await fill(field("Start time"), "09:00");
  await fill(field("End time"), "17:30");
  await choose("Timezone", "UTC");
  await execute();
  assert.equal(await copied(), "0.354 days (8.5 hours)");
  await click(button("Restore settings panel"));
  await click(field("Exact duration"));
  await execute();
  assert.equal(await copied(), "0.354 days");
  await fill(field(/^End date/), "2024-01-02");
  await execute();
  assert.equal(await copied(), "1.354 days");
});

test("date difference keeps invalid input editable and removes feedback after a corrected calculation", async () => {
  const view = await mountWorkspace(definition, run, undefined, { text: "2024-01-01", secondary: "invalid" });
  await execute();
  assert.ok(view.container.textContent.includes("End date is not a valid date or timestamp."));
  const unavailableCopy = button("Copy all");
  assert.equal(unavailableCopy?.disabled, true, "Copy stays disabled until a valid result exists");
  await click(unavailableCopy);
  assert.equal(writeText.mock.calls.length, 0, "Invalid results cannot write to the clipboard");
  await fill(field(/^End date/), "2024-01-03");
  await execute();
  assert.equal(await copied(), "2 days (48 hours)");
  assert.ok(!view.container.textContent.includes("End date is not a valid date or timestamp."));
});
