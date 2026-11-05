import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getCommonMessages } from "../lib/i18n/messages.ts";
import { extractToolMessages, toolMessageTree } from "../lib/tool-framework/translations.ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ContrastWorkspace from "../tools/contrast-checker/workspace.tsx";
const definition = await toolSpec("contrast-checker");
import { run } from "../tools/contrast-checker/run.ts";

vi.mock("@/components/ResultView", () => ({ ResultActions: () => null }));

let container;
let root;
let currentSettings;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(initialSettings = {}) {
  function Fixture() {
    const [settings, setSettings] = useState({
      ...Object.fromEntries(Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default])),
      ...initialSettings,
    });
    currentSettings = settings;
    return React.createElement(ContrastWorkspace, {
      settings,
      input: { text: "", files: [] },
      spec: definition,
      lifecycle: "completed",
      result: run({ settings }),
      onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
      onInputChange: () => {},
    });
  }
  await act(() =>
    root.render(
      React.createElement(
        NextIntlClientProvider,
        {
          locale: "en",
          messages: { ...getCommonMessages("en"), Tool: toolMessageTree(extractToolMessages(definition)) },
          timeZone: "UTC",
        },
        React.createElement(Fixture),
      ),
    ),
  );
}

const editor = (label) => container.querySelector(`textarea[aria-label="${label}"], input[aria-label="${label}"]`);

async function openEditor(label) {
  const button = container.querySelector(`button[aria-label="Edit ${label}"]`);
  expect(button).toBeTruthy();
  await act(() => button.click());
  expect(editor(label)).toBeTruthy();
  return editor(label);
}

async function fill(field, value) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(field, key) {
  await act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function commit(label, text) {
  const field = await openEditor(label);
  await fill(field, text);
  await press(field, "Enter");
  expect(editor(label)).toBeNull();
}

test("heading and body edits commit independently and survive a text-color change", async () => {
  await mount();
  const samples = [
    ["Preview heading", "Readable headings for everyone"],
    ["Preview body text", "Custom body copy.\nA second line to compare."],
  ];
  for (const [label, value] of samples) await commit(label, value);
  expect(currentSettings.sample).toBe(samples[0][1]);
  expect(currentSettings.bodySample).toBe(samples[1][1]);
  const color = container.querySelector('input[aria-label="Choose text color visually"]');
  await fill(color, "#0f172a");
  expect(currentSettings.foreground.toLowerCase()).toBe("#0f172a");
  for (const [label, value] of samples) {
    const field = await openEditor(label);
    expect(field.value).toBe(value);
    await press(field, "Escape");
  }
});

test("restored preview settings appear in the preview and editable fields", async () => {
  const sample = "A shared heading with café & color";
  const bodySample = "The recipient sees this copy.\nIncluding its second line.";
  await mount({ sample, bodySample });
  expect(container.textContent).toContain(sample);
  expect(container.textContent).toContain(bodySample);
  for (const [label, value] of [
    ["Preview heading", sample],
    ["Preview body text", bodySample],
  ]) {
    expect((await openEditor(label)).value).toBe(value);
    await press(editor(label), "Escape");
  }
});

test.each(["Preview heading", "Preview body text"])("Escape restores the previously committed %s", async (label) => {
  await mount();
  await commit(label, "Keep this edited sample.");
  const field = await openEditor(label);
  await fill(field, "Discard this unfinished replacement.");
  await press(field, "Escape");
  expect(editor(label)).toBeNull();
  expect((await openEditor(label)).value).toBe("Keep this edited sample.");
});
