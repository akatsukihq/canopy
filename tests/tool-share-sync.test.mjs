import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { setupReactTools, mountTool } from "./helpers/react-tools.mjs";
import { useToolShare } from "../lib/tool-framework/useToolShare.ts";
import { decodeToolShare, encodeToolShare } from "../lib/tool-framework/toolShare.ts";
const queryBuilderSpec = await toolSpec("url-query-builder");

setupReactTools();
const spec = {
  toolId: "devtools.test",
  sharing: { version: 1 },
  input: { kind: "text", label: "Input" },
  settings: { fields: { upper: { kind: "toggle", label: "Uppercase", default: false } } },
  trigger: { mode: "live" },
};
const input = (text) => ({ text, files: [] });
let latest;
function Fixture(props) {
  latest = useToolShare(props);
  return null;
}
function parameters(overrides = {}) {
  const source = input("hello");
  const settings = { upper: false };
  return {
    spec,
    input: source,
    settings,
    lifecycle: "completed",
    completed: { input: source, settings },
    initialize: vi.fn(),
    run: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}
async function tick(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  window.history.replaceState({ router: "preserved" }, "", "/devtools/test");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("updates only after 300ms of idle input and preserves the history entry", async () => {
  let props = parameters();
  const view = await mountTool(React.createElement(Fixture, props));
  expect(window.location.hash).toBe("");
  const next = input("Hello 🌏\n&=#");
  props = { ...props, input: next, completed: { input: next, settings: props.settings } };
  await view.rerender(React.createElement(Fixture, props));
  await tick(299);
  expect(window.location.hash).toBe("");
  await tick(1);
  expect(decodeToolShare(spec, window.location.hash).state.input.text).toBe(next.text);
  expect(window.history.state).toEqual({ router: "preserved" });
  expect(props.run).not.toHaveBeenCalled();
});

test("coalesces edits and waits for their matching result without another 300ms delay", async () => {
  let props = parameters();
  const view = await mountTool(React.createElement(Fixture, props));
  props = { ...props, input: input("first"), lifecycle: "running" };
  await view.rerender(React.createElement(Fixture, props));
  await tick(200);
  props = { ...props, input: input("second") };
  await view.rerender(React.createElement(Fixture, props));
  await tick(300);
  expect(window.location.hash).toBe("");
  props = { ...props, lifecycle: "completed", completed: { input: props.input, settings: props.settings } };
  await view.rerender(React.createElement(Fixture, props));
  await tick(0);
  expect(decodeToolShare(spec, window.location.hash).state.input.text).toBe("second");
});

test("restores complete URL state then runs a manual tool once after initialization", async () => {
  const manualSpec = { ...spec, trigger: { mode: "manual", actionLabel: "Run" } };
  const shared = { input: { text: "shared" }, settings: { upper: true } };
  window.history.replaceState(null, "", encodeToolShare(manualSpec, shared).hash);
  let props = parameters({ spec: manualSpec, lifecycle: "empty", completed: null });
  const view = await mountTool(React.createElement(Fixture, props));
  expect(props.initialize).toHaveBeenCalledWith(shared);
  expect(props.run).not.toHaveBeenCalled();
  props = { ...props, input: input("shared"), settings: shared.settings, lifecycle: "ready" };
  await view.rerender(React.createElement(Fixture, props));
  await tick(0);
  expect(props.run).toHaveBeenCalledTimes(1);
  await view.rerender(React.createElement(Fixture, { ...props, lifecycle: "running" }));
  expect(props.run).toHaveBeenCalledTimes(1);
});

test("URL Query Builder restores rows and resumes 300ms sharing after editing a row", async () => {
  const shared = {
    input: { text: "https://example.com/search", secondary: "source=shared\ntag=existing" },
    settings: {
      parameters: [
        { key: "tag", value: "café & tea" },
        { key: "tag", value: "" },
      ],
      encodeValues: true,
      skipEmptyRows: false,
      sortParameters: true,
    },
  };
  const encoded = encodeToolShare(queryBuilderSpec, shared);
  expect(encoded).toHaveProperty("hash");
  window.history.replaceState(window.history.state, "", encoded.hash);

  let props = parameters({ spec: queryBuilderSpec, lifecycle: "empty", completed: null });
  const view = await mountTool(React.createElement(Fixture, props));
  expect(props.initialize).toHaveBeenCalledExactlyOnceWith(shared);
  const restored = props.initialize.mock.calls[0][0];
  props = {
    ...props,
    input: { ...restored.input, files: [] },
    settings: restored.settings,
    lifecycle: "ready",
  };
  await view.rerender(React.createElement(Fixture, props));
  await tick(0);
  expect(props.run).toHaveBeenCalledTimes(1);
  props = { ...props, lifecycle: "completed", completed: { input: props.input, settings: props.settings } };
  await view.rerender(React.createElement(Fixture, props));
  await tick(0);
  expect(latest.canCopy).toBe(true);
  expect(decodeToolShare(queryBuilderSpec, window.location.hash)).toEqual({ state: shared });

  const editedSettings = {
    ...props.settings,
    parameters: [{ key: "tag", value: "edited = value 🌏" }, props.settings.parameters[1]],
  };
  props = { ...props, settings: editedSettings, lifecycle: "ready" };
  await view.rerender(React.createElement(Fixture, props));
  expect(window.location.hash).toBe("");
  expect(latest.canCopy).toBe(false);
  expect(props.run).toHaveBeenCalledTimes(1);

  props = { ...props, lifecycle: "completed", completed: { input: props.input, settings: props.settings } };
  await view.rerender(React.createElement(Fixture, props));
  await tick(299);
  expect(window.location.hash).toBe("");
  await tick(1);
  expect(decodeToolShare(queryBuilderSpec, window.location.hash)).toEqual({
    state: { input: shared.input, settings: editedSettings },
  });
  expect(latest.canCopy).toBe(true);
  expect(props.onError).not.toHaveBeenCalled();
});

test("removes a stale URL when inputs change and clears it on reset", async () => {
  let props = parameters();
  const view = await mountTool(React.createElement(Fixture, props));
  props = { ...props, input: input("current") };
  props.completed = { input: props.input, settings: props.settings };
  await view.rerender(React.createElement(Fixture, props));
  await tick(300);
  expect(window.location.hash).toMatch(/^#share=/);
  props = { ...props, input: input("unrun"), lifecycle: "ready" };
  await view.rerender(React.createElement(Fixture, props));
  expect(window.location.hash).toBe("");
  await act(async () => latest.clear());
  props = { ...props, input: input(""), settings: { upper: false } };
  props.completed = { input: props.input, settings: props.settings };
  await view.rerender(React.createElement(Fixture, { ...props, lifecycle: "completed" }));
  await tick(500);
  expect(window.location.hash).toBe("");
});

test("rejects malformed links without breaking editing and leaves unrelated anchors alone", async () => {
  window.history.replaceState(null, "", "#share=broken");
  const props = parameters();
  const view = await mountTool(React.createElement(Fixture, props));
  expect(props.onError).toHaveBeenCalledOnce();
  expect(props.initialize).toHaveBeenCalledWith(null);
  expect(window.location.hash).toBe("");
  await view.unmount();
  window.history.replaceState(null, "", "#how-to-use");
  await mountTool(React.createElement(Fixture, parameters()));
  await tick(500);
  expect(window.location.hash).toBe("#how-to-use");
});

test("restores hash navigation and clean navigation without duplicate restoration", async () => {
  const props = parameters();
  await mountTool(React.createElement(Fixture, props));
  props.initialize.mockClear();
  const shared = { input: { text: "navigated" }, settings: { upper: true } };
  await act(async () => {
    window.history.replaceState(null, "", encodeToolShare(spec, shared).hash);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(props.initialize).toHaveBeenCalledExactlyOnceWith(shared);
  await act(async () => {
    window.history.replaceState(null, "", "/devtools/test");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(props.initialize).toHaveBeenLastCalledWith(null);
});

test("unsupported tools stay unchanged and file inputs never enter URLs", async () => {
  const view = await mountTool(React.createElement(Fixture, parameters({ spec: { ...spec, sharing: undefined } })));
  await view.rerender(React.createElement(Fixture, parameters({ spec: { ...spec, sharing: undefined } })));
  await tick(500);
  expect(window.location.hash).toBe("");
  expect(latest.canCopy).toBe(false);
  await view.unmount();
  const props = parameters();
  const enabled = await mountTool(React.createElement(Fixture, props));
  const fileInput = { text: "file text", files: [new File(["file text"], "file.txt")] };
  await enabled.rerender(
    React.createElement(Fixture, {
      ...props,
      input: fileInput,
      completed: { input: fileInput, settings: props.settings },
    }),
  );
  await tick(500);
  expect(window.location.hash).toBe("");
});

test("oversized complete URLs and failed history writes keep the tool usable", async () => {
  let props = parameters();
  const view = await mountTool(React.createElement(Fixture, props));
  props = { ...props, input: input("x".repeat(5000)) };
  props.completed = { input: props.input, settings: props.settings };
  await view.rerender(React.createElement(Fixture, props));
  await tick(300);
  expect(window.location.hash).toBe("");
  expect(props.onError).toHaveBeenCalled();
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  props = { ...props, input: input("small") };
  props.completed = { input: props.input, settings: props.settings };
  await view.rerender(React.createElement(Fixture, props));
  await tick(300);
  expect(latest.canCopy).toBe(false);
});
