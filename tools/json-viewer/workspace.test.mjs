import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { act } from "react";
import { expect, test, vi } from "vitest";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, selectView, press } from "../../tests/helpers/json-workspaces.mjs";
import ViewerWorkspace from "./workspace.tsx";
const viewerDefinition = await toolSpec("json-viewer");
import { run as viewJson } from "./run.worker.ts";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();

test("translated controls and structured error navigation leave JSON source untouched", async () => {
  const source = '{\n  "missing":\n}';
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, {
    text: source,
    locale: "hi",
    messages: {
      "runtime.repair": "सुधारें",
      "runtime.goToError": "पंक्ति {line, number}, स्तंभ {column, number} पर जाएँ",
      "runtime.goToErrorLabel": "पंक्ति {line, number}, स्तंभ {column, number} पर जाएँ",
      "runtime.errors.json-syntax": "पंक्ति {line, number}, स्तंभ {column, number} में JSON त्रुटि है।",
    },
  });
  expect(button("सुधारें")).toBeTruthy();
  expect(view.state.error).toContain("JSON त्रुटि");
  expect(view.state.error).not.toContain("line");
  expect(button(/पंक्ति .*स्तंभ .*पर जाएँ/)).toBeTruthy();
  expect(view.state.errorLocation.line).toBeGreaterThan(0);
  expect(view.state.input.text).toBe(source);
});

test("JSON viewer edits result values with undo/redo while preserving the source", async () => {
  const source = '{"name":"Ada","active":false}';
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, { text: source });
  await waitFor(() => expect(field("JSON result code")?.value).toContain('"Ada"'));
  await selectView("Form");
  await fill(field("Edit name"), "Lin");
  await press(field("Edit name"), "Enter");
  expect(view.state.input.text).toBe(source);
  expect(button("Undo JSON edit").disabled).toBe(false);
  await click(button("Undo JSON edit"));
  expect(field("Edit name").value).toBe("Ada");
  await click(button("Redo JSON edit"));
  expect(field("Edit name").value).toBe("Lin");
  await selectView("Code");
  expect(field("JSON result code").value).toContain('"Lin"');
  const clipboard = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  await click(button("Copy JSON result"));
  expect(JSON.parse(clipboard.mock.calls[0][0])).toEqual({ name: "Lin", active: false });
});

test("JSON viewer repairs missing values to null and copies the repaired artifact", async () => {
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, {
    text: '{"name":"Ada","age":}',
    settings: { repairMode: "null" },
  });
  await waitFor(() => expect(view.state.error).toMatch(/valid/i));
  await click(button("Repair & clean"));
  expect(JSON.parse(field("JSON result code").value)).toEqual({ name: "Ada", age: null });
  const clipboard = vi.fn().mockResolvedValue();
  vi.stubGlobal(
    "navigator",
    Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText: clipboard } }),
  );
  await click(button("Copy JSON result"));
  expect(JSON.parse(clipboard.mock.calls[0][0])).toEqual({ name: "Ada", age: null });
  expect(view.state.input.text).toBe('{"name":"Ada","age":}');
});

test("JSON viewer removing broken properties supports cancellation before repair", async () => {
  await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, {
    text: '{"name":"Ada","age":}',
    settings: { repairMode: "remove" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click(button("Repair & clean"));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("$.age"));
  expect(document.querySelector('[data-testid="json-result-placeholder"]')).toBeTruthy();
  confirm.mockReturnValue(true);
  await click(button("Repair & clean"));
  expect(JSON.parse(field("JSON result code").value)).toEqual({ name: "Ada" });
});

test("JSON viewer minify, beautify and clear controls keep source and transformed result distinct", async () => {
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, { text: '{"name":"Ada"}' });
  await waitFor(() => expect(field("JSON result code")?.value).toContain("\n"));
  await click(button("Minify JSON code"));
  expect(field("JSON result code").value).toBe('{"name":"Ada"}');
  await click(button("Beautify JSON code"));
  expect(field("JSON result code").value).toBe('{\n  "name": "Ada"\n}');
  await click(button("Clear"));
  await waitFor(() => {
    expect(view.state.input.text).toBe("");
    expect(view.state.error).not.toBe("");
    expect(view.state.result).toBeNull();
  });
  expect(button("Copy JSON input").disabled).toBe(true);
});
test("JSON viewer preserves exact high-precision source through blocked transforms, copy and download", async () => {
  const source = '{"id":9007199254740993,"tiny":1.234567890123456789}';
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, { text: source });
  await waitFor(() => expect(view.state.result).not.toBeNull());
  const clipboard = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  expect(field("JSON result code").value).toBe(source);
  await click(button("Minify JSON code"));
  await click(button("Beautify JSON code"));
  expect(field("JSON result code").value).toBe(source);
  await click(button("Copy JSON result"));
  expect(clipboard).toHaveBeenCalledTimes(1);
  expect(clipboard).toHaveBeenCalledWith(source);

  const createObjectURL = vi.fn().mockReturnValue("blob:json-result");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const downloadedNames = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloadedNames.push(this.download);
  });
  await click(button("Download JSON result"));
  const exported = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(createObjectURL.mock.calls[0][0]);
  });
  expect(exported).toBe(source);
  expect(downloadedNames).toEqual(["smarttools-json-viewer.json"]);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:json-result");
});

test("JSON viewer search, expansion and recovery preserve source contents", async () => {
  const source = '{"users":[{"name":"Ada"}],"active":false}';
  const view = await mountWorkspace(ViewerWorkspace, viewerDefinition, viewJson, { text: source });
  await waitFor(() => expect(field("JSON result code")?.value).toContain("Ada"));
  await selectView("View");
  await click(button("Expand all JSON nodes"));
  expect(view.container.textContent).toContain('"Ada"');
  await fill(field("Search JSON result"), "missing-key");
  expect(view.container.textContent).toContain("No keys or values match");
  await fill(field("Search JSON result"), "Ada");
  expect(view.container.textContent).toContain('"Ada"');
  expect(view.state.input.text).toBe(source);
  await fill(field("JSON input"), "{");
  await waitFor(() => expect(view.state.result).toBeNull());
  expect(document.querySelector('[data-testid="json-result-placeholder"]')).toBeTruthy();
  await fill(field("JSON input"), '{"restored":true}');
  await waitFor(() => expect(view.state.result?.value).toEqual({ restored: true }));
  await fill(field("Search JSON result"), "");
  expect(view.container.textContent).toContain("restored");
});
