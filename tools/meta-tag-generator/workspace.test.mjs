import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("meta-tag-generator");
import { run } from "./run.ts";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

// This parent feeds executor results back into the controlled workspace. Runtime
// trigger/debounce/reset behavior is covered separately by the runtime suite.
function Fixture({ disabled = false }) {
  const [input, setInput] = useState({ text: "Original title", secondary: "Original description", files: [] });
  const [settings, setSettings] = useState(parseSettings(definition.settings, {}));
  let result = null;
  let error;
  try {
    result = run({ input, settings });
  } catch (failure) {
    error = failure.message;
  }
  return React.createElement(Workspace, {
    spec: definition,
    input,
    settings,
    result,
    error,
    disabled,
    lifecycle: error ? "failed" : "completed",
    onInputChange: setInput,
    onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
  });
}

test("meta workspace edits actual inputs, exposes readonly generated markup, and copies exact content", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await mountTool(React.createElement(Fixture), { spec: definition });
  await fill(field(/^Page title/), "A & B");
  await fill(field(/^Meta description/), "A private description");
  const output = field("Generated meta tags");
  assert.equal(output.readOnly, true);
  assert.ok(output.value.includes("<title>A &amp; B</title>"));
  assert.ok(output.value.includes('content="A private description"'));
  await click(button("Copy all"));
  assert.deepEqual(writeText.mock.calls, [[output.value]]);
});

test("meta workspace optional toggles update generated tags and invalid canonical URLs recover", async () => {
  const { container } = await mountTool(React.createElement(Fixture), { spec: definition });
  await click(button("Restore settings panel"));
  const toggle = (label) =>
    [...document.querySelectorAll('[role="switch"]')].find(
      (element) => element.getAttribute("aria-label") === label || element.id === field(label)?.id,
    );
  await click(toggle("Include Open Graph"));
  assert.ok(!field("Generated meta tags").value.includes("og:title"));
  await click(toggle("Include Twitter card"));
  assert.ok(field("Generated meta tags").value.includes("twitter:card"));
  await fill(field("Canonical URL"), "/relative");
  assert.ok(container.textContent.includes("Canonical URL must be an absolute http or https URL."));
  await fill(field("Canonical URL"), "https://example.com/recovered");
  assert.ok(field("Generated meta tags").value.includes('href="https://example.com/recovered"'));
  assert.ok(!container.textContent.includes("Canonical URL must be an absolute"));
});

test("meta workspace disables editable inputs when the host disables it", async () => {
  await mountTool(React.createElement(Fixture, { disabled: true }), { spec: definition });
  for (const label of [/^Page title/, /^Meta description/, "Author", "Keywords", "Canonical URL"])
    assert.equal(field(label).disabled, true);
});
