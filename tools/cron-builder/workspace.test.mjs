import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("cron-builder");
import { run } from "./run.ts";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

function Fixture({ disabled = false }) {
  const [settings, setSettings] = useState(parseSettings(definition.settings, {}));
  let result = null;
  let error;
  try {
    result = run({ settings });
  } catch (failure) {
    error = failure.message;
  }
  return React.createElement(Workspace, {
    spec: definition,
    input: { text: "", files: [] },
    settings,
    result,
    error,
    disabled,
    lifecycle: error ? "failed" : "completed",
    onInputChange() {},
    onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
  });
}

test("cron builder edits the schedule and copies the actual expression and description", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { container } = await mountTool(React.createElement(Fixture), { spec: definition });
  assert.equal(field("Minute").value, "0");
  await fill(field("Hour"), "14");
  await fill(field("Minute"), "30");
  await fill(field("Command label (optional)"), "Backup");
  assert.ok(container.textContent.includes("At 14:30, Monday through Friday."));
  await click(button("Copy all"));
  assert.deepEqual(writeText.mock.calls, [["30 14 * * 1-5\nAt 14:30, Monday through Friday.\nLabel: Backup"]]);
});

test("cron builder exposes a field error for invalid minutes and recovers after correction", async () => {
  const { container } = await mountTool(React.createElement(Fixture), { spec: definition });
  const minute = field("Minute");
  await fill(minute, "60");
  assert.equal(minute.getAttribute("aria-invalid"), "true");
  const described = minute
    .getAttribute("aria-errormessage")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  assert.match(described, /between 0 and 59/);
  await fill(minute, "15");
  assert.notEqual(minute.getAttribute("aria-invalid"), "true");
  assert.ok(container.textContent.includes("At 09:15, Monday through Friday."));
  assert.ok(!container.textContent.includes("Minute must be between 0 and 59"));
});

test("cron builder opens syntax help and disables all schedule inputs while unavailable", async () => {
  const view = await mountTool(React.createElement(Fixture), { spec: definition });
  await click(button("Syntax help"));
  assert.ok(view.container.textContent.includes("At minutes 0, 15, 30 and 45"));
  await view.rerender(React.createElement(Fixture, { disabled: true }));
  for (const label of ["Minute", "Hour", "Day of month", "Month", "Day of week"])
    assert.equal(field(label).disabled, true);
});
