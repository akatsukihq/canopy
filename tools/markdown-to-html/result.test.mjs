import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ResultSurface } from "../../components/ResultSurface.tsx";
import { withToolIntl } from "../../tests/helpers/react-tools.mjs";
const definition = await toolSpec("markdown-to-html");

vi.mock("@/components/content/CodeEditor", () => ({
  CodeEditor: ({ value, "aria-label": label }) =>
    React.createElement("textarea", { "aria-label": label, value, readOnly: true }),
}));

let container;
let root;
let writeText;
let blobs;
let downloads;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
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
    downloads.push({ name: this.download, href: this.href });
  });
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

const result = {
  render: "html",
  html: "<h1>Hello &amp; welcome</h1>\n<p><strong>Exact HTML</strong> &lt;value&gt;</p>\n",
  downloadName: "converted.html",
};

async function mount(props = {}) {
  await act(() =>
    root.render(withToolIntl(React.createElement(ResultSurface, { spec: definition, result, ...props }), definition)),
  );
}

const tabs = () => [...container.querySelectorAll('[role="tablist"][aria-label="Result view"] [role="tab"]')];
const activePanel = () => container.querySelector('[role="tabpanel"][data-state="active"]');

async function chooseView(label) {
  const tab = tabs().find((item) => item.textContent === label);
  expect(tab).toBeTruthy();
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false })));
}

test("Preview is first and selected by default; Raw shows exact HTML and can switch back", async () => {
  await mount();
  expect(tabs().map((tab) => tab.textContent)).toEqual(["Preview", "Raw"]);
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  expect(activePanel().querySelector('iframe[title="Generated HTML preview"]').getAttribute("srcdoc")).toBe(
    result.html,
  );
  await chooseView("Raw");
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  expect(activePanel().querySelector('textarea[aria-label="Result code"]').value).toBe(result.html);
  expect(activePanel().querySelector("iframe")).toBeNull();
  await chooseView("Preview");
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  expect(activePanel().querySelector("iframe").getAttribute("srcdoc")).toBe(result.html);
});

test("copy and download preserve generated HTML in both result views", async () => {
  await mount();
  const copy = container.querySelector('button[aria-label="Copy all"]');
  for (const view of ["Preview", "Raw"]) {
    await chooseView(view);
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith(result.html);
    const download = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Download .html",
    );
    expect(download).toBeTruthy();
    await act(() => download.click());
    expect(downloads.at(-1).name).toBe("converted.html");
    expect(await blobs.at(-1).text()).toBe(result.html);
  }
});

test("HTML results without a view preference keep their existing preview", async () => {
  await mount({ spec: { ...definition, resultView: undefined } });
  expect(tabs()).toHaveLength(0);
  expect(container.querySelector('iframe[title="Generated HTML preview"]').getAttribute("srcdoc")).toBe(result.html);
  expect(container.querySelector("textarea")).toBeNull();
});

test("retained HTML can be inspected in either view while export remains disabled", async () => {
  await mount({ result: null, retainedResult: result, running: true });
  expect(activePanel().querySelector("iframe").getAttribute("srcdoc")).toBe(result.html);
  await chooseView("Raw");
  expect(activePanel().querySelector("textarea").value).toBe(result.html);
  expect(container.querySelector('button[aria-label="Copy all"]').disabled).toBe(true);
  const download = [...container.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith("Download"),
  );
  expect(download.disabled).toBe(true);
  expect(downloads).toEqual([]);
});
