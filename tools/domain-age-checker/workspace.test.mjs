import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import AgeWorkspace from "./workspace.tsx";
const ageSpec = await toolSpec("domain-age-checker");
import React, { act, useState } from "react";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, expect, test, vi } from "vitest";
import {
  setupReactTools,
  mountTool,
  fill,
  click,
  button,
  field,
  TextEditorBoundary,
} from "../../tests/helpers/react-tools.mjs";
import { openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", () => ({
  CodeEditor: (props) => React.createElement(TextEditorBoundary, props),
}));

setupReactTools();
let clipboard, blobs, downloads;
beforeEach(() => {
  clipboard = vi.fn(async () => {});
  vi.stubGlobal(
    "navigator",
    Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText: clipboard } }),
  );
  vi.stubGlobal("Blob", NodeBlob);
  blobs = [];
  downloads = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:test-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push(this.download);
  });
});

const tools = [{ key: "domain-age-checker", Workspace: AgeWorkspace, spec: ageSpec, label: /Domain name/ }];

async function workspace(tool, options = {}) {
  const onRun = vi.fn(),
    onCancel = vi.fn(),
    onToolbarActionsChange = vi.fn();
  let currentInput, currentSettings;
  function Fixture() {
    const [input, setInput] = useState({ text: options.text ?? "", files: [] });
    const [settings, setSettings] = useState(
      Object.fromEntries(Object.entries(tool.spec.settings.fields).map(([key, entry]) => [key, entry.default])),
    );
    currentInput = input;
    currentSettings = settings;
    return React.createElement(tool.Workspace, {
      spec: tool.spec,
      input,
      settings,
      result: options.result ?? null,
      error: options.error,
      lifecycle: options.running ? "running" : options.error ? "failed" : options.result ? "completed" : "ready",
      running: options.running ?? false,
      disabled: options.disabled ?? false,
      onInputChange: setInput,
      onSettingChange: (key, value) => setSettings((previous) => ({ ...previous, [key]: value })),
      onToolbarActionsChange,
      primaryAction: {
        label: tool.spec.trigger.actionLabel,
        onRun,
        onCancel,
        disabled: options.actionDisabled ?? false,
        running: options.actionRunning ?? false,
      },
    });
  }
  return {
    ...(await mountTool(React.createElement(Fixture), { spec: tool.spec })),
    onRun,
    onCancel,
    onToolbarActionsChange,
    input: () => currentInput,
    settings: () => currentSettings,
  };
}

for (const tool of tools) {
  test(`${tool.key}: required input blocks submission and recovers after editing`, async () => {
    const view = await workspace(tool);
    const input = field(tool.label, view.container);
    expect(input).toBeTruthy();
    expect(button(tool.spec.trigger.actionLabel).disabled).toBe(true);
    await fill(input, " ");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby"))?.textContent).toMatch(/domain/i);
    await fill(input, "example.com");
    expect(view.input().text).toBe("example.com");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(button(tool.spec.trigger.actionLabel).disabled).toBe(false);
    await click(button(tool.spec.trigger.actionLabel));
    expect(view.onRun).toHaveBeenCalledTimes(1);
  });

  test.each([{ disabled: true }, { actionDisabled: true }])(
    `${tool.key}: blocked action %j cannot submit`,
    async (state) => {
      const view = await workspace(tool, { text: "example.com", ...state });
      expect(button(tool.spec.trigger.actionLabel).disabled).toBe(true);
      await act(() =>
        view.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(view.onRun).not.toHaveBeenCalled();
    },
  );

  test.each([{ running: true }, { actionRunning: true }])(
    `${tool.key}: processing %j freezes input and cancellation calls the owner`,
    async (state) => {
      const view = await workspace(tool, { text: "example.com", ...state });
      expect(field(tool.label).disabled).toBe(true);
      await click(button("Cancel"));
      expect(view.onCancel).toHaveBeenCalledTimes(1);
      expect(view.onRun).not.toHaveBeenCalled();
    },
  );

  test(`${tool.key}: unmount releases the workspace-owned toolbar action`, async () => {
    const view = await workspace(tool);
    expect(view.onToolbarActionsChange).toHaveBeenLastCalledWith({ primaryActionInWorkspace: true });
    await view.unmount();
    expect(view.onToolbarActionsChange).toHaveBeenLastCalledWith(null);
  });
}

const ageResult = {
  render: "text",
  downloadName: "domain-registration.json",
  text: JSON.stringify(
    {
      domain: "example.com",
      registered: "2000-01-01T00:00:00Z",
      expires: "2030-01-01T00:00:00Z",
      updated: null,
      status: ["clientTransferProhibited"],
      nameservers: ["ns1.example.com"],
    },
    null,
    2,
  ),
};

async function chooseView(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === label);
  expect(tab).toBeTruthy();
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
}

for (const [tool, result] of [[tools[0], ageResult]]) {
  test(`${tool.key}: summary and raw views preserve exact copy and download contents`, async () => {
    const view = await workspace(tool, { text: "example.com", result });
    expect(view.container.textContent).toContain("Transfer locked");
    expect(view.container.textContent).toContain("ns1.example.com");
    for (const mode of ["Raw", "Preview"]) {
      await chooseView(mode);
      await click(button(/^(Copy all|Copied)$/));
      expect(clipboard).toHaveBeenLastCalledWith(result.text);
      await click(button(/^Download/));
      expect(downloads.at(-1)).toBe(result.downloadName);
      expect(await blobs.at(-1).text()).toBe(result.text);
      if (mode === "Raw")
        expect([...view.container.querySelectorAll("textarea")].some((node) => node.value === result.text)).toBe(true);
    }
  });
}

test("domain age settings change independently without changing source input", async () => {
  const view = await workspace(tools[0], { text: "example.com" });
  await openSettings(view.container);
  const toggles = [...view.container.querySelectorAll('[role="switch"],input[type="checkbox"]')];
  expect(toggles.length).toBe(2);
  await click(toggles[0]);
  expect(view.settings()).toEqual({ showRegistrationDate: false, showExpiryDate: true });
  await click(toggles[1]);
  expect(view.settings()).toEqual({ showRegistrationDate: false, showExpiryDate: false });
  expect(view.input().text).toBe("example.com");
});
