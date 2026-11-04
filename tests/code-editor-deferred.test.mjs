// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const features = vi.hoisted(() => ({ jobs: [], language: vi.fn(), completion: vi.fn() }));
vi.mock("../components/content/deferredEditorFeatures.ts", () => ({
  scheduleEditorFeatures(callback) {
    const job = { callback, cancelled: false, started: false };
    features.jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  },
}));
vi.mock("../components/content/codeEditorLanguages.ts", () => ({
  loadCodeEditorLanguage: features.language,
}));
vi.mock("../components/content/codeEditorCompletions.ts", () => ({
  loadCodeEditorCompletions: features.completion,
}));

import CodeEditorImpl from "../components/content/CodeEditorImpl.tsx";

let container;
let root;
const rangeMeasurementDescriptors = Object.fromEntries(
  ["getClientRects", "getBoundingClientRect"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Range.prototype, name),
  ]),
);

const languageExtension = (name) => EditorView.contentAttributes.of({ "data-loaded-language": name });
const completionExtension = EditorView.contentAttributes.of({ "data-loaded-completions": "true" });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout; provide the same empty geometry as its Element APIs.
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  features.jobs.length = 0;
  features.language.mockReset().mockImplementation(async (name) => languageExtension(name));
  features.completion.mockReset().mockResolvedValue({ automatic: completionExtension, manual: completionExtension });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(() => root.unmount());
  container.remove();
  for (const [name, descriptor] of Object.entries(rangeMeasurementDescriptors)) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else delete Range.prototype[name];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(value, props = {}) {
  await act(() => root.render(React.createElement(CodeEditorImpl, { value, language: "javascript", ...props })));
  return EditorView.findFromDOM(container.querySelector(".cm-editor"));
}

async function focus(view) {
  await act(() => {
    view.focus();
    // Flush CodeMirror's delayed focus notification without waiting on layout in jsdom.
    view.update([]);
  });
}

async function startDeferredFeatures() {
  await act(async () => {
    for (const job of features.jobs) {
      if (job.cancelled || job.started) continue;
      job.started = true;
      job.callback();
    }
    await vi.dynamicImportSettled();
  });
}

test("typing and maximum length enforcement work before optional features load", async () => {
  const onChange = vi.fn();
  const view = await render("abc", { onChange, maxLength: 4 });
  await act(() =>
    view.dispatch({ changes: { from: 3, insert: "d" }, selection: { anchor: 4 }, userEvent: "input.type" }),
  );
  expect(view.state.doc.toString()).toBe("abcd");
  expect(onChange).toHaveBeenLastCalledWith("abcd");

  await act(() => view.dispatch({ changes: { from: 4, insert: "e" }, userEvent: "input.type" }));
  expect(view.state.doc.toString()).toBe("abcd");
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(features.language).not.toHaveBeenCalled();
  expect(features.completion).not.toHaveBeenCalled();
});

test("focusing never bypasses deferred loading, and unfocused editors do not load completion", async () => {
  const view = await render("const name = 'Ada'", { onChange: vi.fn() });
  expect(features.language).not.toHaveBeenCalled();
  await startDeferredFeatures();
  expect(features.language).toHaveBeenCalledWith("javascript");
  expect(features.completion).not.toHaveBeenCalled();

  await focus(view);
  expect(features.completion).not.toHaveBeenCalled();
  await startDeferredFeatures();
  expect(features.completion).toHaveBeenCalledWith("javascript", false);
  expect(view.contentDOM.getAttribute("data-loaded-completions")).toBe("true");
});

test("late language and completion extensions preserve typed content, selection, and undo", async () => {
  let resolveLanguage;
  features.language.mockReturnValue(
    new Promise((resolve) => {
      resolveLanguage = resolve;
    }),
  );
  const onChange = vi.fn();
  const view = await render("abc", { onChange });
  await act(() =>
    view.dispatch({ changes: { from: 3, insert: "d" }, selection: { anchor: 2 }, userEvent: "input.type" }),
  );
  await startDeferredFeatures();
  await act(async () => resolveLanguage(languageExtension("javascript")));
  await focus(view);
  await startDeferredFeatures();

  expect(EditorView.findFromDOM(container.querySelector(".cm-editor"))).toBe(view);
  expect(view.contentDOM.getAttribute("data-loaded-language")).toBe("javascript");
  expect(view.contentDOM.getAttribute("data-loaded-completions")).toBe("true");
  expect(view.state.doc.toString()).toBe("abcd");
  expect(view.state.selection.main.head).toBe(2);
  expect(onChange).toHaveBeenCalledTimes(1);
  await act(() => expect(undo(view)).toBe(true));
  expect(view.state.doc.toString()).toBe("abc");
  expect(onChange).toHaveBeenLastCalledWith("abc");
});

test.each(["readOnly", "disabled"])("%s editors never load completion", async (mode) => {
  const view = await render("const answer = 42", { onChange: vi.fn(), [mode]: true });
  await focus(view);
  await startDeferredFeatures();

  expect(view.state.readOnly).toBe(true);
  expect(features.language).toHaveBeenCalledWith("javascript");
  expect(features.completion).not.toHaveBeenCalled();
  expect(view.contentDOM.hasAttribute("data-loaded-completions")).toBe(false);
});

test("external value changes do not echo onChange and can restore content beyond an input limit", async () => {
  const onChange = vi.fn();
  const view = await render("abc", { onChange, maxLength: 4 });
  await render("restored source", { onChange, maxLength: 4 });
  expect(view.state.doc.toString()).toBe("restored source");
  expect(onChange).not.toHaveBeenCalled();

  await act(() =>
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "edit" }, userEvent: "input.type" }),
  );
  expect(view.state.doc.toString()).toBe("edit");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("edit");
});

test("an old language load resolving after a language switch cannot replace the current extension", async () => {
  const resolveLanguages = new Map();
  features.language.mockImplementation(
    (name) =>
      new Promise((resolve) => {
        resolveLanguages.set(name, resolve);
      }),
  );
  const onChange = vi.fn();
  const view = await render("source", { onChange, language: "html" });
  await startDeferredFeatures();
  await render("source", { onChange, language: "css" });
  await startDeferredFeatures();
  await act(async () => resolveLanguages.get("css")(languageExtension("css")));
  expect(view.contentDOM.getAttribute("data-loaded-language")).toBe("css");

  await act(async () => resolveLanguages.get("html")(languageExtension("html")));
  expect(view.contentDOM.getAttribute("data-loaded-language")).toBe("css");
  expect(view.state.doc.toString()).toBe("source");
  expect(onChange).not.toHaveBeenCalled();
});

test("unmount cancels queued optional features and safely ignores already pending language loads", async () => {
  let resolveLanguage;
  features.language.mockReturnValue(
    new Promise((resolve) => {
      resolveLanguage = resolve;
    }),
  );
  const view = await render("source", { onChange: vi.fn() });
  await startDeferredFeatures();
  await focus(view);
  await act(() => root.unmount());
  root = null;

  await startDeferredFeatures();
  await act(async () => resolveLanguage(languageExtension("javascript")));
  expect(features.completion).not.toHaveBeenCalled();
  expect(view.destroyed).toBe(true);
  expect(container.children).toHaveLength(0);
});
