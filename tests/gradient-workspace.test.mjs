import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getCommonMessages } from "../lib/i18n/messages.ts";
import { extractToolMessages, toolMessageTree } from "../lib/tool-framework/translations.ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import GradientWorkspace from "../tools/gradient-generator/workspace.tsx";
const definition = await toolSpec("gradient-generator");
import { run } from "../tools/gradient-generator/run.ts";

vi.mock("@/components/ResultSurface", () => ({
  ResultSurface: ({ result }) => React.createElement("output", null, result?.text),
}));

let container;
let root;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else delete HTMLElement.prototype.scrollIntoView;
});

async function mount(initial = {}) {
  function Fixture() {
    const [settings, setSettings] = useState({
      ...Object.fromEntries(Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default])),
      ...initial,
    });
    const [input, setInput] = useState({ text: "#2563eb", secondary: "#7c3aed", files: [] });
    return React.createElement(GradientWorkspace, {
      settings,
      input,
      spec: definition,
      lifecycle: "completed",
      result: run({ input, settings }),
      onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
      onInputChange: setInput,
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

const presetLabel = () => container.querySelector("#gradient-preset").textContent;

async function choose(id, label) {
  const trigger = container.querySelector(`#${id}`);
  await act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent === label);
  expect(option).toBeTruthy();
  await act(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

async function edit(label, next) {
  const field =
    container.querySelector(`input[aria-label="${label}"]`) ??
    [...container.querySelectorAll("label")].find((item) => item.textContent === label)?.control;
  expect(field).toBeTruthy();
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, String(next));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the default gradient displays its matching preset instead of a placeholder", async () => {
  await mount();
  expect(presetLabel()).toBe("Blue to purple");
});

test("selecting presets updates the displayed choice and returning restores the default name", async () => {
  await mount();
  await choose("gradient-preset", "Sunset");
  expect(presetLabel()).toBe("Sunset");
  await choose("gradient-preset", "Ocean");
  expect(presetLabel()).toBe("Ocean");
  await choose("gradient-preset", "Blue to purple");
  expect(presetLabel()).toBe("Blue to purple");
});

test("editing stop positions shows Custom and undoing the edit or resetting restores the preset", async () => {
  await mount();
  await choose("gradient-preset", "Sunset");
  await edit("Stop position value", 12);
  expect(presetLabel()).toBe("Custom");
  await edit("Stop position value", 0);
  expect(presetLabel()).toBe("Sunset");
  await edit("Stop position value", 25);
  const reset = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset");
  await act(() => reset.click());
  expect(presetLabel()).toBe("Blue to purple");
});

test("editing a stop color shows Custom until its preset color is restored", async () => {
  await mount();
  await choose("gradient-preset", "Sunset");
  await edit("Selected stop color", "#123456");
  expect(presetLabel()).toBe("Custom");
  await edit("Selected stop color", "#fb7185");
  expect(presetLabel()).toBe("Sunset");
});

test("gradient geometry changes retain the matching color preset", async () => {
  await mount();
  await choose("gradient-preset", "Ocean");
  await edit("Angle value", 45);
  expect(presetLabel()).toBe("Ocean");
  await choose("gradient-type", "Radial");
  await edit("Center X value", 30);
  await choose("gradient-shape", "Ellipse");
  expect(presetLabel()).toBe("Ocean");
});

test("restored stops match by color and position independently of their generated IDs", async () => {
  await mount({
    stops: JSON.stringify([
      { id: "restored-one", color: " #FB7185 ", position: 0 },
      { id: "restored-two", color: "#FBBF24", position: 50 },
      { id: "restored-three", color: "#7C3AED", position: 100 },
    ]),
  });
  expect(presetLabel()).toBe("Sunset");
});
