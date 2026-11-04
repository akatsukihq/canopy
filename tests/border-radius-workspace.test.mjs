import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getCommonMessages } from "../lib/i18n/messages.ts";
import { extractToolMessages, toolMessageTree } from "../lib/tool-framework/translations.ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BorderRadiusWorkspace from "../tools/border-radius-generator/workspace.tsx";
const definition = await toolSpec("border-radius-generator");
import { run } from "../tools/border-radius-generator/run.ts";

vi.mock("@/components/ResultSurface", () => ({
  ResultSurface: ({ result }) => React.createElement("output", { "aria-label": "Border radius CSS" }, result?.text),
}));

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

async function mount(initial = {}, { retainInitialResult = false } = {}) {
  function Fixture() {
    const [settings, setSettings] = useState({
      ...Object.fromEntries(Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default])),
      ...initial,
    });
    const [initialResult] = useState(() => run({ settings }));
    currentSettings = settings;
    return React.createElement(BorderRadiusWorkspace, {
      settings,
      spec: definition,
      input: { text: "", files: [] },
      lifecycle: "completed",
      result: retainInitialResult ? initialResult : run({ settings }),
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
  const shape = container.querySelector('[role="img"]').parentElement;
  vi.spyOn(shape, "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 200, height: 100 });
  for (const handle of container.querySelectorAll('[role="slider"]')) {
    const captured = new Set();
    handle.setPointerCapture = (id) => captured.add(id);
    handle.hasPointerCapture = (id) => captured.has(id);
    handle.releasePointerCapture = (id) => captured.delete(id);
  }
}

const handle = (label) => container.querySelector(`[role="slider"][aria-label="${label} handle"]`);
const css = () => container.querySelector("output").textContent;
const input = (key) => container.querySelector(`#radius-${key}`);
const radii = {
  topLeft: 16,
  topRight: 16,
  bottomRight: 16,
  bottomLeft: 16,
  topLeftY: 16,
  topRightY: 16,
  bottomRightY: 16,
  bottomLeftY: 16,
};

async function pointer(element, type, options = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...options });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    isPrimary: { value: options.isPrimary ?? true },
    pointerType: { value: "mouse" },
  });
  await act(() => element.dispatchEvent(event));
}

async function key(element, name, options = {}) {
  await act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...options })));
}

async function edit(name, next) {
  const field = input(name);
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, String(next));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(label) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeTruthy();
  await act(() => button.click());
}

test("four fixed-edge handles share the original corner fields and settings", async () => {
  await mount({ linked: false });
  expect(container.querySelectorAll('[role="slider"]')).toHaveLength(4);
  for (const name of ["Top X", "Right Y", "Bottom X", "Left Y"]) expect(handle(name)).toBeTruthy();
  for (const corner of ["topLeft", "topRight", "bottomRight", "bottomLeft"]) expect(input(corner).value).toBe("16");
  expect(css()).toBe("border-radius: 16px;");
  await edit("topLeft", 72);
  expect(Number(handle("Top X").getAttribute("aria-valuenow"))).toBe(72);
  await pointer(handle("Top X"), "pointerdown", { clientX: 160 });
  await pointer(handle("Top X"), "pointermove", { clientX: 180 });
  expect(input("topLeft").value).toBe("100");
  expect(currentSettings).toMatchObject({ ...radii, topLeft: 100, linked: false, elliptical: false });
  expect(css()).toBe("border-radius: 100px 16px 16px;");
});

test("handle positions use raw corner radii on their fixed edges", async () => {
  await mount({ topLeft: 72, topRight: 40, bottomRight: 28, bottomLeft: 20 });
  expect(parseFloat(handle("Top X").style.left)).toBeCloseTo((72 / 280) * 100);
  expect(handle("Top X").style.top).toBe("0px");
  expect(parseFloat(handle("Right Y").style.top)).toBe(20);
  expect(handle("Right Y").style.left).toBe("100%");
  expect(parseFloat(handle("Bottom X").style.left)).toBe(90);
  expect(handle("Bottom X").style.top).toBe("100%");
  expect(parseFloat(handle("Left Y").style.top)).toBe(90);
  expect(handle("Left Y").style.left).toBe("0px");
});

test.each([
  ["Top X", "clientX", 20, "topLeft", 44],
  ["Right Y", "clientY", 10, "topRight", 36],
  ["Bottom X", "clientX", -20, "bottomRight", 44],
  ["Left Y", "clientY", -10, "bottomLeft", 36],
])(
  "%s edits its scalar corner along the anchored direction when unlinked",
  async (label, coordinate, delta, changed, expected) => {
    await mount({ linked: false });
    const before = { ...currentSettings };
    await pointer(handle(label), "pointerdown", { [coordinate]: 100 });
    await pointer(handle(label), "pointermove", { [coordinate]: 100 + delta });
    expect(currentSettings).toEqual({ ...before, [changed]: expected });
  },
);

test.each([
  ["Top X", "clientX", 20, "topLeft", 44],
  ["Right Y", "clientY", 10, "topRightY", 36],
  ["Bottom X", "clientX", -20, "bottomRight", 44],
  ["Left Y", "clientY", -10, "bottomLeftY", 36],
])(
  "%s edits only its existing elliptical axis without changing other fields or toggles",
  async (label, coordinate, delta, changed, expected) => {
    await mount({ elliptical: true, linked: false });
    const before = { ...currentSettings };
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(4);
    for (const corner of ["topLeft", "topRight", "bottomRight", "bottomLeft"])
      expect(input(`${corner}-y`).value).toBe("16");
    await pointer(handle(label), "pointerdown", { [coordinate]: 100 });
    await pointer(handle(label), "pointermove", { [coordinate]: 100 + delta });
    expect(currentSettings).toEqual({ ...before, [changed]: expected });
  },
);

test("editing an original vertical field moves its corresponding elliptical handle", async () => {
  await mount({ elliptical: true, linked: false });
  await edit("topRight-y", 65);
  expect(Number(handle("Right Y").getAttribute("aria-valuenow"))).toBe(65);
  expect(parseFloat(handle("Right Y").style.top)).toBe(32.5);
  expect(css()).toBe("border-radius: 16px / 16px 65px 16px 16px;");
});

test("linked scalar handles update four corners while preserving dormant vertical fields", async () => {
  await mount({ topLeftY: 8 });
  await pointer(handle("Right Y"), "pointerdown", { clientY: 80 });
  await pointer(handle("Right Y"), "pointermove", { clientY: 90 });
  expect(currentSettings).toMatchObject({
    ...radii,
    topLeft: 36,
    topRight: 36,
    bottomLeft: 36,
    bottomRight: 36,
    topLeftY: 8,
    linked: true,
    elliptical: false,
  });
  expect(css()).toBe("border-radius: 36px;");
});

test("linked elliptical handles update the selected axis across corners", async () => {
  await mount({ elliptical: true });
  await pointer(handle("Right Y"), "pointerdown", { clientY: 80 });
  await pointer(handle("Right Y"), "pointermove", { clientY: 90 });
  expect(currentSettings).toMatchObject({
    ...radii,
    topLeftY: 36,
    topRightY: 36,
    bottomLeftY: 36,
    bottomRightY: 36,
    linked: true,
    elliptical: true,
  });
  expect(css()).toBe("border-radius: 16px / 36px;");
});

test("clicking without moving leaves all original settings unchanged", async () => {
  await mount({ topLeft: 23, topRight: 62 });
  const before = { ...currentSettings };
  await pointer(handle("Top X"), "pointerdown", { clientX: 123 });
  await pointer(handle("Top X"), "pointermove", { clientX: 123 });
  await pointer(handle("Top X"), "pointerup", { clientX: 123 });
  expect(currentSettings).toEqual(before);
});

test("off-center grabs retain continuous fractional pointer deltas", async () => {
  await mount({ linked: false });
  await pointer(handle("Top X"), "pointerdown", { clientX: 130 });
  await pointer(handle("Top X"), "pointermove", { clientX: 130.5 });
  expect(currentSettings.topLeft).toBe(16.7);
  await pointer(handle("Top X"), "pointermove", { clientX: 131 });
  expect(currentSettings).toMatchObject({ ...radii, topLeft: 17.4, linked: false, elliptical: false });
});

test("the preview updates from corner settings before the generated result catches up", async () => {
  await mount({ linked: false }, { retainInitialResult: true });
  await pointer(handle("Top X"), "pointerdown", { clientX: 120 });
  await pointer(handle("Top X"), "pointermove", { clientX: 140 });
  expect(css()).toBe("border-radius: 16px;");
  expect(container.querySelector('[role="img"]').style.borderRadius).toBe("44px 16px 16px 16px / 44px 16px 16px 16px");
});

test.each(["pointerup", "pointercancel", "lostpointercapture"])(
  "%s from another handle or pointer cannot mutate or end the active drag",
  async (eventType) => {
    await mount({ linked: false });
    await pointer(handle("Top X"), "pointerdown", { clientX: 120 });
    await pointer(handle("Top X"), "pointermove", { clientX: 140 });
    const before = { ...currentSettings };
    await pointer(handle("Right Y"), "pointerdown", { pointerId: 2, clientY: 100 });
    await pointer(handle("Right Y"), eventType, { pointerId: 2, clientY: 130 });
    await pointer(handle("Right Y"), eventType, { pointerId: 1, clientY: 130 });
    await pointer(handle("Top X"), eventType, { pointerId: 2, clientX: 180 });
    expect(currentSettings).toEqual(before);
    await pointer(handle("Top X"), "pointermove", { clientX: 150 });
    expect(currentSettings.topLeft).toBe(58);
  },
);

test.each(["pointercancel", "Escape"])("%s restores exact original corner values and toggle states", async (cancel) => {
  await mount({ topLeft: 23.456, topRight: 62.5, topRightY: 75, bottomLeftY: 10 });
  const before = { ...currentSettings };
  const initialCss = css();
  await pointer(handle("Top X"), "pointerdown", { clientX: 140 });
  await pointer(handle("Top X"), "pointermove", { clientX: 160 });
  expect(currentSettings.topLeft).toBeCloseTo(51.456, 4);
  if (cancel === "Escape") await key(handle("Top X"), "Escape");
  else await pointer(handle("Top X"), cancel);
  expect(currentSettings).toEqual(before);
  expect(css()).toBe(initialCss);
  await pointer(handle("Top X"), "pointermove", { clientX: 180 });
  expect(currentSettings).toEqual(before);
});

test("Escape on another handle preserves the active drag", async () => {
  await mount({ linked: false });
  await pointer(handle("Top X"), "pointerdown", { clientX: 120 });
  await pointer(handle("Top X"), "pointermove", { clientX: 140 });
  const before = { ...currentSettings };
  await key(handle("Right Y"), "Escape");
  expect(currentSettings).toEqual(before);
  await pointer(handle("Top X"), "pointermove", { clientX: 150 });
  expect(currentSettings.topLeft).toBe(58);
});

test("releasing a pointer keeps its final corner value and stops subsequent motion", async () => {
  await mount({ linked: false });
  await pointer(handle("Right Y"), "pointerdown", { clientY: 100 });
  await pointer(handle("Right Y"), "pointermove", { clientY: 110 });
  await pointer(handle("Right Y"), "pointerup", { clientY: 125 });
  expect(currentSettings.topRight).toBe(66);
  await pointer(handle("Right Y"), "pointermove", { clientY: 90 });
  expect(currentSettings.topRight).toBe(66);
});

test("arrow keys follow the fixed axis and anchor while ignoring orthogonal arrows", async () => {
  await mount({ elliptical: true, linked: false });
  await key(handle("Top X"), "ArrowUp");
  expect(currentSettings.topLeft).toBe(16);
  await key(handle("Top X"), "ArrowRight");
  await key(handle("Top X"), "ArrowLeft", { shiftKey: true });
  expect(currentSettings.topLeft).toBe(7);
  await key(handle("Right Y"), "ArrowRight");
  expect(currentSettings.topRightY).toBe(16);
  await key(handle("Right Y"), "ArrowDown");
  await key(handle("Bottom X"), "ArrowLeft");
  await key(handle("Left Y"), "ArrowUp");
  expect(currentSettings).toMatchObject({
    topRightY: 17,
    bottomRight: 17,
    bottomLeftY: 17,
    elliptical: true,
    linked: false,
  });
});

test.each([
  ["Top X", "topLeft", 280],
  ["Right Y", "topRightY", 200],
  ["Bottom X", "bottomRight", 280],
  ["Left Y", "bottomLeftY", 200],
])("%s traverses its full axis without changing neighboring radii", async (label, corner, maximum) => {
  await mount({ elliptical: true, linked: false });
  const before = { ...currentSettings };
  await key(handle(label), "Home");
  expect(currentSettings).toEqual({ ...before, [corner]: 0 });
  await key(handle(label), "End");
  expect(currentSettings).toEqual({ ...before, [corner]: maximum });
});

test("the reported asymmetric shape permits full-width dragging without normalization", async () => {
  await mount({ linked: false, topLeft: 130.5641, topRight: 74.8943, bottomLeft: 69.4359, bottomRight: 125.1057 });
  const before = { ...currentSettings };
  await pointer(handle("Top X"), "pointerdown", { clientX: 200 });
  await pointer(handle("Top X"), "pointermove", { clientX: 500 });
  expect(currentSettings).toEqual({ ...before, topLeft: 280 });
  expect(handle("Top X").style.left).toBe("100%");
});

test.each([
  ["Top X", { clientX: 200, clientY: 100 }, { clientX: 200, clientY: 130 }],
  ["Right Y", { clientX: 200, clientY: 100 }, { clientX: 240, clientY: 100 }],
])("%s ignores pointer movement perpendicular to its edge", async (label, start, end) => {
  await mount();
  const before = { ...currentSettings };
  await pointer(handle(label), "pointerdown", start);
  await pointer(handle(label), "pointermove", end);
  expect(currentSettings).toEqual(before);
});

test("percentage dragging uses the appropriate displayed axis dimensions", async () => {
  await mount({ unit: "%", elliptical: true, linked: false });
  await pointer(handle("Top X"), "pointerdown", { clientX: 120 });
  await pointer(handle("Top X"), "pointermove", { clientX: 140 });
  await pointer(handle("Top X"), "pointerup", { clientX: 140 });
  await pointer(handle("Right Y"), "pointerdown", { clientY: 80 });
  await pointer(handle("Right Y"), "pointermove", { clientY: 90 });
  expect(currentSettings).toMatchObject({
    ...radii,
    topLeft: 26,
    topRightY: 26,
    unit: "%",
    linked: false,
    elliptical: true,
  });
  expect(css()).toBe("border-radius: 26% 16% 16% / 16% 26% 16% 16%;");
});

test("rem dragging honors the original root font size setting", async () => {
  await mount({ unit: "rem", rootFontSize: 20, linked: false, topLeft: 1, topRight: 1, bottomLeft: 1, bottomRight: 1 });
  await pointer(handle("Top X"), "pointerdown", { clientX: 130 });
  await pointer(handle("Top X"), "pointermove", { clientX: 150 });
  expect(currentSettings).toMatchObject({
    topLeft: 2.4,
    topRight: 1,
    unit: "rem",
    rootFontSize: 20,
    linked: false,
    elliptical: false,
  });
  expect(css()).toBe("border-radius: 2.4rem 1rem 1rem;");
});

test("an oversized pill can be dragged back from the endpoint while dormant values are preserved", async () => {
  await mount();
  await click("Pill");
  await pointer(handle("Top X"), "pointerdown", { clientX: 150 });
  await pointer(handle("Top X"), "pointermove", { clientX: 140 });
  expect(currentSettings).toMatchObject({
    topLeft: 266,
    topRight: 266,
    bottomLeft: 266,
    bottomRight: 266,
    topLeftY: 9999,
    topRightY: 9999,
    bottomLeftY: 9999,
    bottomRightY: 9999,
    linked: true,
    elliptical: false,
  });
  expect(css()).toBe("border-radius: 266px;");
});

test.each([
  ["Card", 16, "px", 280, 200],
  ["Pill", 9999, "px", 280, 100],
  ["Circle", 50, "%", 220, 220],
  ["Reset shape", 16, "px", 280, 200],
])("%s retains its original corner preset behavior", async (label, radius, unit, width, height) => {
  await mount({
    topLeft: 13,
    topRightY: 74,
    width: 400,
    height: 300,
    unit: "rem",
    rootFontSize: 20,
    elliptical: true,
    linked: false,
  });
  await click(label);
  for (const name of Object.keys(radii)) expect(currentSettings[name]).toBe(radius);
  expect(currentSettings).toMatchObject({ unit, width, height, rootFontSize: 16, linked: true, elliptical: false });
  expect(container.querySelectorAll('[role="slider"]')).toHaveLength(4);
  expect(css()).toBe(`border-radius: ${radius}${unit};`);
});

test.each(["width", "height"])(
  "%s accepts a complete number without clamping intermediate keystrokes",
  async (name) => {
    await mount({ width: 400, height: 300 });
    const previous = currentSettings[name];
    for (const draft of ["", "2", "28"]) {
      await edit(name, draft);
      expect(input(name).value).toBe(draft);
      expect(currentSettings[name]).toBe(previous);
      expect(container.querySelector('[role="img"]').style[name]).toBe(`${previous}px`);
    }
    await edit(name, "280");
    expect(input(name).value).toBe("280");
    expect(currentSettings[name]).toBe(280);
    expect(container.querySelector('[role="img"]').style[name]).toBe("280px");
  },
);

test.each([
  ["width", "2", 40],
  ["height", "9000", 1200],
  ["width", "", 400],
  ["height", "", 300],
  ["rootFontSize", "0", 1],
  ["rootFontSize", "999", 100],
  ["rootFontSize", "", 20],
])("blurring %s with draft %s commits its bounded value or restores a blank", async (name, draft, expected) => {
  await mount({ width: 400, height: 300, unit: "rem", rootFontSize: 20 });
  const before = currentSettings[name];
  await act(() => input(name).focus());
  await edit(name, draft);
  expect(currentSettings[name]).toBe(before);
  await act(() => input(name).blur());
  expect(currentSettings[name]).toBe(expected);
  expect(input(name).value).toBe(String(expected));
});

test.each([
  ["width", "2", 40],
  ["height", "9000", 1200],
  ["width", "", 400],
  ["rootFontSize", "999", 100],
])("Enter commits the %s draft %s using the same bounds as blur", async (name, draft, expected) => {
  await mount({ width: 400, height: 300, unit: "rem", rootFontSize: 20 });
  await act(() => input(name).focus());
  await edit(name, draft);
  await key(input(name), "Enter");
  expect(currentSettings[name]).toBe(expected);
  expect(input(name).value).toBe(String(expected));
});

test.each([
  ["width", 500, "2"],
  ["height", 350, ""],
  ["rootFontSize", 24, "999"],
])("Escape discards the %s draft and keeps its latest valid live value", async (name, committed, draft) => {
  await mount({ width: 400, height: 300, unit: "rem", rootFontSize: 20 });
  await act(() => input(name).focus());
  await edit(name, committed);
  expect(currentSettings[name]).toBe(committed);
  await edit(name, draft);
  await key(input(name), "Escape");
  expect(currentSettings[name]).toBe(committed);
  expect(input(name).value).toBe(String(committed));
  await act(() => input(name).blur());
  expect(currentSettings[name]).toBe(committed);
});

test.each([
  ["Card", 280, 200],
  ["Pill", 280, 100],
  ["Circle", 220, 220],
  ["Reset shape", 280, 200],
])("%s clears pending dimension drafts even when a restored dimension is unchanged", async (label, width, height) => {
  await mount();
  await edit("width", "2");
  await edit("height", "");
  await click(label);
  expect(currentSettings).toMatchObject({ width, height });
  expect(input("width").value).toBe(String(width));
  expect(input("height").value).toBe(String(height));
});
