import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DnsCheckerWorkspace from "./workspace.tsx";
import { withToolIntl } from "../../tests/helpers/react-tools.mjs";
const definition = await toolSpec("dns-checker");

vi.mock("@/components/ResultSurface", () => ({ ResultSurface: () => null }));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));

let container;
let root;
let currentSettings;
let onRun;
let onValidationChange;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
  onRun = vi.fn();
  onValidationChange = vi.fn();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount({
  domain = "example.com",
  types,
  disabled = false,
  running = false,
  actionDisabled = false,
  actionRunning = false,
} = {}) {
  function Fixture() {
    const [settings, setSettings] = useState({
      ...Object.fromEntries(Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default])),
      ...(types === undefined ? {} : { types }),
    });
    const [input, setInput] = useState({ text: domain, files: [] });
    currentSettings = settings;
    return React.createElement(DnsCheckerWorkspace, {
      disabled,
      running,
      settings,
      input,
      spec: definition,
      lifecycle: running ? "running" : "idle",
      result: null,
      onInputChange: setInput,
      onSettingChange: (key, value) => setSettings((current) => ({ ...current, [key]: value })),
      onValidationChange,
      primaryAction: { label: "Check DNS", onRun, disabled: actionDisabled, running: actionRunning },
    });
  }
  await act(() => root.render(withToolIntl(React.createElement(Fixture), definition)));
}

const domainInput = () => {
  const label = [...container.querySelectorAll("label")].find((item) => item.textContent.includes("Domain name"));
  return document.getElementById(label.htmlFor);
};
const typeTrigger = () => container.querySelector('button[aria-label="Record types"]');
const typeOption = (name) => document.querySelector(`[role="checkbox"][aria-label="${name}"]`);
const selectedTypes = () => new Set(currentSettings.types.split(",").filter(Boolean));

async function openTypes() {
  expect(typeTrigger()).not.toBeNull();
  await act(() => typeTrigger().click());
}

async function toggleType(name) {
  expect(typeOption(name)).not.toBeNull();
  await act(() => typeOption(name).click());
}

async function fillDomain(value) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(domainInput(), value);
    domainInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(options = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
  await act(() => domainInput().dispatchEvent(event));
  return event;
}

test("record types supports multiple selections without dropping other selected records", async () => {
  await mount();
  await openTypes();
  for (const name of ["A", "AAAA", "MX", "TXT", "NS", "CNAME"]) {
    expect(typeOption(name).getAttribute("aria-checked")).toBe("true");
  }
  await toggleType("MX");
  expect(selectedTypes()).toEqual(new Set(["A", "AAAA", "TXT", "NS", "CNAME"]));
  expect(typeOption("MX").getAttribute("aria-checked")).toBe("false");
  await toggleType("TXT");
  await toggleType("MX");
  expect(selectedTypes()).toEqual(new Set(["A", "AAAA", "MX", "NS", "CNAME"]));
  expect(typeOption("MX").getAttribute("aria-checked")).toBe("true");
  expect(typeOption("TXT").getAttribute("aria-checked")).toBe("false");
});

test("deselecting every record type blocks submission and selecting one restores readiness", async () => {
  await mount({ types: "MX" });
  await openTypes();
  await toggleType("MX");
  expect(currentSettings.types).toBe("");
  expect(onValidationChange).toHaveBeenLastCalledWith(expect.stringMatching(/select.*record type/i));
  expect(typeTrigger().getAttribute("aria-invalid")).toBe("true");
  const errorId = typeTrigger().getAttribute("aria-describedby");
  expect(
    errorId
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent)
      .join(" "),
  ).toMatch(/select.*record type/i);
  await pressEnter();
  expect(onRun).not.toHaveBeenCalled();
  await toggleType("TXT");
  expect(selectedTypes()).toEqual(new Set(["TXT"]));
  expect(onValidationChange).toHaveBeenLastCalledWith(null);
  expect(typeTrigger().getAttribute("aria-invalid")).not.toBe("true");
  await pressEnter();
  expect(onRun).toHaveBeenCalledTimes(1);
});

test("Enter on a valid domain runs the DNS check once", async () => {
  await mount({ types: "A,MX" });
  expect(onValidationChange).toHaveBeenLastCalledWith(null);
  expect((await pressEnter()).defaultPrevented).toBe(true);
  expect(onRun).toHaveBeenCalledTimes(1);
});

test.each(["", "   ", "not a domain", "localhost"])("Enter with invalid domain %j cannot run", async (domain) => {
  await mount({ domain });
  expect(onValidationChange).toHaveBeenLastCalledWith(expect.any(String));
  await pressEnter();
  expect(onRun).not.toHaveBeenCalled();
});

test("domain validation is associated with the input and clears after recovery", async () => {
  await mount();
  await fillDomain("not a domain");
  expect(domainInput().getAttribute("aria-invalid")).toBe("true");
  const errorId = domainInput().getAttribute("aria-describedby");
  expect(
    errorId
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent)
      .join(" "),
  ).toMatch(/valid domain/i);
  await pressEnter();
  expect(onRun).not.toHaveBeenCalled();
  await fillDomain("https://www.example.com/path");
  expect(domainInput().getAttribute("aria-invalid")).not.toBe("true");
  expect(onValidationChange).toHaveBeenLastCalledWith(null);
  await pressEnter();
  expect(onRun).toHaveBeenCalledTimes(1);
});

test.each([{ disabled: true }, { running: true }, { actionDisabled: true }, { actionRunning: true }])(
  "Enter cannot run while unavailable: %j",
  async (options) => {
    await mount(options);
    await pressEnter();
    expect(onRun).not.toHaveBeenCalled();
  },
);

test.each([
  { repeat: true },
  { shiftKey: true },
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { isComposing: true },
])("modified, held, or composing Enter cannot run: %j", async (options) => {
  await mount();
  await pressEnter(options);
  expect(onRun).not.toHaveBeenCalled();
  await pressEnter();
  expect(onRun).toHaveBeenCalledTimes(1);
});
