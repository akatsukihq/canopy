import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Blob as NodeBlob } from "node:buffer";
import React, { act, useState } from "react";
import { beforeEach, test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("curl-to-axios");
import { run } from "./run.ts";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
import { setupReactTools, mountTool, click, button, field, fill } from "../../tests/helpers/react-tools.mjs";

const notifications = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/index.tsx", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, toast: { ...actual.toast, ...notifications } };
});
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

const command = "curl https://example.com/users -H 'Accept: application/json'";
const initialSettings = parseSettings(definition.settings, {});
let writeText;
beforeEach(() => {
  notifications.error.mockReset().mockImplementation(() => `conversion-error-${notifications.error.mock.calls.length}`);
  notifications.dismiss.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});

function workspaceProps(overrides = {}) {
  return {
    spec: definition,
    input: { text: command, files: [] },
    settings: initialSettings,
    result: null,
    lifecycle: "ready",
    onInputChange() {},
    onSettingChange() {},
    ...overrides,
  };
}

test("conversion errors notify once per failure and dismiss when the command recovers", async () => {
  const error = "cURL command needs an absolute http or https URL.";
  const props = workspaceProps({ error, lifecycle: "failed" });
  const view = await mountTool(React.createElement(Workspace, props), { spec: definition });
  assert.equal(notifications.error.mock.calls.length, 1);
  assert.equal(notifications.error.mock.calls[0][0], "Unable to convert");
  assert.equal(notifications.error.mock.calls[0][1].description, error);
  assert.equal(view.container.textContent.includes(error), false);

  await view.rerender(React.createElement(Workspace, { ...props, settings: { ...initialSettings } }));
  assert.equal(notifications.error.mock.calls.length, 1);
  assert.equal(notifications.dismiss.mock.calls.length, 0);

  const recovered = workspaceProps({
    result: run({ input: { text: command }, settings: initialSettings }),
    lifecycle: "completed",
  });
  await view.rerender(React.createElement(Workspace, recovered));
  assert.deepEqual(notifications.dismiss.mock.calls, [["conversion-error-1"]]);
  assert.equal(field("Result code", view.container).value, recovered.result.text);

  await view.rerender(React.createElement(Workspace, props));
  assert.equal(notifications.error.mock.calls.length, 2);
  await view.unmount();
  assert.deepEqual(notifications.dismiss.mock.calls, [["conversion-error-1"], ["conversion-error-2"]]);
});

test("a different conversion failure replaces the previous notification", async () => {
  const view = await mountTool(
    React.createElement(Workspace, workspaceProps({ error: "Missing URL", lifecycle: "failed" })),
    { spec: definition },
  );
  await view.rerender(React.createElement(Workspace, workspaceProps({ error: "Unclosed quote", lifecycle: "failed" })));
  assert.equal(notifications.error.mock.calls.length, 2);
  assert.equal(notifications.error.mock.calls[1][1].description, "Unclosed quote");
  assert.deepEqual(notifications.dismiss.mock.calls, [["conversion-error-1"]]);
});

function Fixture() {
  const [input, setInput] = useState({ text: command, files: [] });
  const [settings, setSettings] = useState(initialSettings);
  return React.createElement(
    Workspace,
    workspaceProps({
      input,
      settings,
      result: run({ input, settings }),
      lifecycle: "completed",
      onInputChange: setInput,
      onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
    }),
  );
}

async function selectOption(name, label) {
  await click(field(name));
  await click([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.trim() === label));
}

test("input and output options regenerate readonly Axios code and keep exact copy/download contents", async () => {
  const blobs = [];
  const downloads = [];
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:axios-test-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push({ name: this.download, href: this.href });
  });
  const { container } = await mountTool(React.createElement(Fixture), { spec: definition });
  const text = "curl -X POST https://example.com/orders -H 'Content-Type: application/json' --data '{\"count\":2}'";
  await fill(field("cURL command", container), text);
  assert.equal(field("cURL command", container).value, text);
  assert.equal(field("Result code", container).readOnly, true);
  assert.equal(field("Result code", container).value, run({ input: { text }, settings: initialSettings }).text);

  await selectOption("Output language", "TypeScript");
  await click(button("Restore settings panel", container));
  await selectOption("Module format", "ES module import");
  await act(() =>
    button("Aliases", container).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
  );
  const settings = { ...initialSettings, outputLanguage: "typescript", moduleFormat: "esm", requestStyle: "alias" };
  const result = run({ input: { text }, settings });
  assert.equal(field("Result code", container).value, result.text);
  await click(button("Copy all", container));
  assert.deepEqual(writeText.mock.calls, [[result.text]]);
  assert.ok(button("Copied", container));
  await click(button("Download .mts", container));
  assert.deepEqual(downloads, [{ name: "axios-request.mts", href: "blob:axios-test-1" }]);
  assert.equal(blobs[0].type, "text/plain;charset=utf-8");
  assert.equal(await blobs[0].text(), result.text);
  assert.equal(notifications.error.mock.calls.length, 0);
});

test("copy and download stay unavailable before conversion produces output", async () => {
  const onSettingChange = vi.fn();
  const { container } = await mountTool(
    React.createElement(
      Workspace,
      workspaceProps({ input: { text: "", files: [] }, lifecycle: "empty", onSettingChange }),
    ),
    { spec: definition },
  );
  assert.equal(button("Copy all", container).disabled, true);
  assert.equal(button("Download", container).disabled, true);
  await click(button("Copy all", container));
  assert.equal(writeText.mock.calls.length, 0);
  await selectOption("Output language", "TypeScript");
  assert.deepEqual(onSettingChange.mock.calls, [["outputLanguage", "typescript"]]);
  assert.equal(notifications.error.mock.calls.length, 0);
});

test("conversion warnings keep the generated code copyable without duplicating inline feedback", async () => {
  const text = `${command} --compressed`;
  const result = run({ input: { text }, settings: initialSettings });
  const { container } = await mountTool(
    React.createElement(Workspace, workspaceProps({ input: { text, files: [] }, result, lifecycle: "completed" })),
    { spec: definition },
  );
  assert.equal(result.notification.level, "warn");
  assert.equal(container.textContent.includes(result.notification.detail), false);
  for (const issue of result.issues) assert.equal(container.textContent.includes(issue.message), false);
  assert.equal(field("Result code", container).value, result.text);
  await click(button("Copy all", container));
  assert.deepEqual(writeText.mock.calls, [[result.text]]);
});
