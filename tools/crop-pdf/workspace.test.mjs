import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("crop-pdf");
import { cropPlan } from "./plan.ts";
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

const pages = vi.hoisted(() => [
  { pageNumber: 1, pageWidth: 400, pageHeight: 600, url: "blob:page-one" },
  { pageNumber: 2, pageWidth: 600, pageHeight: 840, url: "blob:page-two" },
]);

// PDF rendering/navigation is the boundary; the tool's settings, crop overlay,
// keyboard handlers, and geometry validation remain real.
vi.mock("@/components/PdfFileWorkspace", () => ({
  PdfFileWorkspace: (props) => {
    const [pageIndex, setPageIndex] = useState(0);
    let problem = "";
    try {
      props.getPlan(props.settings, pages.length, pages);
    } catch (error) {
      problem = error.message;
    }
    return React.createElement(
      React.Fragment,
      null,
      pages.map((page, index) =>
        React.createElement(
          "button",
          { key: page.pageNumber, onClick: () => setPageIndex(index) },
          `Page ${page.pageNumber}`,
        ),
      ),
      React.createElement(
        "div",
        { "aria-label": `Page ${pages[pageIndex].pageNumber} preview` },
        props.renderPageOverlay(pages[pageIndex], pages),
      ),
      props.renderOptions(pages),
      problem ? React.createElement("div", { role: "alert" }, problem) : null,
      React.createElement("button", { disabled: Boolean(problem), onClick: props.primaryAction?.onRun }, "Crop PDF"),
    );
  },
}));
vi.mock("@/components/GeneratedPdfPreview", () => ({ GeneratedPdfPreview: () => null }));
setupReactTools();

async function workspace() {
  const onInputChange = vi.fn();
  const onRun = vi.fn();
  let settings;
  function Fixture() {
    const [values, setValues] = useState({ pages: "all", cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 });
    const [document] = useState(() => new File(["%PDF-test"], "mixed-pages.pdf", { type: "application/pdf" }));
    settings = values;
    return React.createElement(Workspace, {
      spec: definition,
      input: { text: "", files: [document] },
      settings: values,
      result: null,
      lifecycle: "ready",
      onInputChange,
      onSettingChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
      primaryAction: { label: "Crop PDF", onRun, disabled: false, running: false },
    });
  }
  return {
    ...(await mountTool(React.createElement(Fixture), { spec: definition })),
    settings: () => settings,
    onInputChange,
    onRun,
  };
}

const cropArea = () => document.querySelector('[role="application"][aria-label="Crop area"]');

async function key(target, key, shiftKey = false) {
  assert.ok(target, "The crop must remain available for editing");
  await act(() =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })),
  );
}

async function pointer(target, type, clientX, clientY) {
  assert.ok(target, "The crop must remain available for dragging");
  target.setPointerCapture ??= () => {};
  target.releasePointerCapture ??= () => {};
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  await act(() => target.dispatchEvent(event));
}

async function setBox({ x, y, width, height }) {
  for (const [label, value] of [
    ["Width", width],
    ["Height", height],
    ["Left", x],
    ["Bottom", y],
  ]) {
    await fill(field(label), value);
  }
}

test("moving on a larger selected page keeps the crop valid and usable after switching back", async () => {
  const view = await workspace();
  await setBox({ x: 190, y: 390, width: 200, height: 200 });
  await click(button("Page 2"));
  await key(cropArea(), "ArrowRight", true);
  await key(cropArea(), "ArrowRight", true);
  await key(cropArea(), "ArrowUp", true);
  await key(cropArea(), "ArrowUp", true);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 200, y: 400, width: 200, height: 200 });
  assert.equal(button("Crop PDF").disabled, false);
  await click(button("Page 1"));
  await key(cropArea(), "ArrowLeft");
  assert.equal(view.settings().cropX, 199);
  assert.equal(button("Crop PDF").disabled, false);
  assert.equal(view.onInputChange.mock.calls.length, 0);
});

test("resizing on a larger selected page stops at common page limits while handles stay available", async () => {
  const view = await workspace();
  await setBox({ x: 50, y: 50, width: 340, height: 540 });
  await click(button("Page 2"));
  await key(button("Resize crop right"), "ArrowRight", true);
  await key(button("Resize crop right"), "ArrowRight", true);
  await key(button("Resize crop top"), "ArrowUp", true);
  await key(button("Resize crop top"), "ArrowUp", true);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 50, y: 50, width: 350, height: 550 });
  await click(button("Page 1"));
  await key(button("Resize crop right"), "ArrowLeft");
  assert.equal(view.settings().cropWidth, 349);
  assert.ok(cropArea());
  assert.equal(button("Crop PDF").disabled, false);
});

test("pointer dragging and corner resizing on a larger page preserve PDF points and common limits", async () => {
  const view = await workspace();
  await setBox({ x: 100, y: 100, width: 200, height: 200 });
  await click(button("Page 2"));
  // jsdom has no layout engine. Supply the crop coordinate surface at 50% zoom:
  // 200 × 300 CSS pixels represents its 400 × 600 PDF-point bounds.
  vi.spyOn(cropArea().parentElement, "getBoundingClientRect").mockReturnValue({ width: 200, height: 300 });
  await pointer(cropArea(), "pointerdown", 100, 100);
  await pointer(cropArea(), "pointermove", 105, 95);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 110, y: 110, width: 200, height: 200 });
  await pointer(cropArea(), "pointermove", 1000, -1000);
  await pointer(cropArea(), "pointerup", 1000, -1000);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 200, y: 400, width: 200, height: 200 });

  await setBox({ x: 50, y: 50, width: 100, height: 100 });
  await pointer(button("Resize crop top right"), "pointerdown", 100, 100);
  await pointer(button("Resize crop top right"), "pointermove", 105, 95);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 50, y: 50, width: 110, height: 110 });
  await pointer(button("Resize crop top right"), "pointermove", 1000, -1000);
  await pointer(button("Resize crop top right"), "pointerup", 1000, -1000);
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 50, y: 50, width: 350, height: 550 });
  await click(button("Page 1"));
  assert.ok(cropArea());
  assert.equal(button("Crop PDF").disabled, false);
  assert.equal(view.onInputChange.mock.calls.length, 0);
});

test("manual out-of-bounds settings retain a recoverable crop without resetting or replacing the PDF", async () => {
  const view = await workspace();
  await setBox({ x: 900, y: 900, width: 1000, height: 1000 });
  assert.equal(button("Crop PDF").disabled, true);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /beyond page/);
  assert.ok(cropArea());
  await click(button("Page 2"));
  // The fallback fills the common bounds, so this movement hits the limit.
  // It must still commit all four corrected values, not leave hidden invalid axes.
  await key(cropArea(), "ArrowRight");
  assert.deepEqual(cropPlan(view.settings(), pages).box, { x: 0, y: 0, width: 400, height: 600 });
  assert.equal(button("Crop PDF").disabled, false);
  assert.equal(view.container.querySelector('[role="alert"]'), null);
  await key(button("Resize crop right"), "ArrowLeft", true);
  assert.equal(view.settings().cropWidth, 390);
  await click(button("Crop PDF"));
  assert.equal(view.onRun.mock.calls.length, 1);
  assert.equal(view.onInputChange.mock.calls.length, 0);
});
