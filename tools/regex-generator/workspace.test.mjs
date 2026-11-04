import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("regex-generator");
import { run } from "./run.ts";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
import { setupReactTools, mountTool, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

function Fixture() {
  const [settings, setSettings] = useState(parseSettings(definition.settings, {}));
  return React.createElement(Workspace, {
    spec: definition,
    input: { text: "", files: [] },
    settings,
    result: run({ settings }),
    lifecycle: "completed",
    onInputChange() {},
    onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
  });
}

test("regex workspace selects presets/languages and keeps the generated value readonly and copyable", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await mountTool(React.createElement(Fixture), { spec: definition });
  await click(field("Pattern preset"));
  await click(
    [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.trim() === "Hex color"),
  );
  const output = field("Generated regular expression");
  assert.equal(output.readOnly, true);
  assert.equal(output.value, "/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/");
  await click(field("Language"));
  await click([...document.querySelectorAll('[role="option"]')].find((node) => node.textContent.trim() === "Python"));
  assert.equal(output.value, 'r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b"');
  await click(button("Copy all"));
  assert.deepEqual(writeText.mock.calls, [[output.value]]);
});

test("regex workspace toggles named groups and explanation without changing the selected pattern", async () => {
  await mountTool(React.createElement(Fixture), { spec: definition });
  await click(field("Add named groups"));
  assert.ok(field("Generated regular expression").value.startsWith("/(?<match>"));
  await click(field("Explain pattern"));
  assert.ok(
    field("Generated regular expression").value.startsWith("// Matches a practical email-address shape.\n/(?<match>"),
  );
});
