import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, selectView } from "../../tests/helpers/json-workspaces.mjs";
import { choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";
import FormatterWorkspace from "./workspace.tsx";
const formatterDefinition = await toolSpec("json-formatter");
import { run as formatJson } from "./run.worker.ts";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();

test("JSON formatter switches between structured and exact code views and copies the exact output", async () => {
  const view = await mountWorkspace(FormatterWorkspace, formatterDefinition, formatJson, {
    text: '{"name":"Ada","active":false}',
  });
  await waitFor(() => expect(button("JSON result view")).toBeTruthy());
  expect(view.container.textContent).toContain('"Ada"');
  await selectView("Code");
  expect(field("JSON result code").value).toBe('{\n  "name": "Ada",\n  "active": false\n}');
  const clipboard = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  await click(button("Copy JSON result"));
  expect(clipboard).toHaveBeenCalledWith(view.state.result.text);
});

test("JSON formatter strict errors recover after source editing", async () => {
  const view = await mountWorkspace(FormatterWorkspace, formatterDefinition, formatJson, { text: '{"a":}' });
  await waitFor(() => expect(view.state.error).toMatch(/line.*column/i));
  expect(view.state.result).toBeNull();
  await fill(field("JSON input"), '{"a":1}');
  await waitFor(() => expect(view.state.result?.value).toEqual({ a: 1 }));
  expect(view.state.error).toBe("");
});

test("JSON formatter visible settings change indentation, minification and validation output", async () => {
  const view = await mountWorkspace(FormatterWorkspace, formatterDefinition, formatJson, {
    text: '{"name":"Ada"}',
  });
  await openSettings(view.container);
  await choose("Indentation", "4 spaces");
  await selectView("Code");
  await waitFor(() => expect(field("JSON result code").value).toBe('{\n    "name": "Ada"\n}'));
  await choose("Operation", "Minify");
  await waitFor(() => expect(field("JSON result code").value).toBe('{"name":"Ada"}'));
  expect(field("Indentation")).toBeUndefined();
  await choose("Operation", "Validate");
  await waitFor(() => expect(view.container.textContent).toContain("Valid JSON"));
  expect(view.container.textContent).toContain("Root type: object");
  expect(button("JSON result view")).toBeUndefined();
});
