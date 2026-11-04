import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { act } from "react";
import { expect, test, vi } from "vitest";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, selectView, press } from "../../tests/helpers/json-workspaces.mjs";
import PathWorkspace from "./workspace.tsx";
const pathDefinition = await toolSpec("json-path-tester");
import { run as queryJson } from "./run.ts";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();

test("JSON path suggestions insert a real path and Enter executes it", async () => {
  const view = await mountWorkspace(PathWorkspace, pathDefinition, queryJson, {
    text: '{"users":[{"name":"Ada"}]}',
    settings: { path: "" },
    automatic: false,
  });
  const input = field("JSONPath");
  await fill(input, "users[0].na");
  await act(() => input.focus());
  await waitFor(() => expect(document.querySelector('[role="option"]')?.textContent).toContain("users[0].name"));
  await click(
    [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent.includes("users[0].name")),
  );
  expect(view.state.settings.path).toBe("users[0].name");
  await press(input, "Enter");
  await waitFor(() => expect(view.state.result?.text).toBe('"Ada"'));
  expect(view.onRun).toHaveBeenCalledTimes(1);
});

test("JSON path has no stale suggestions for malformed source and recovers with valid JSON", async () => {
  const view = await mountWorkspace(PathWorkspace, pathDefinition, queryJson, {
    text: "not JSON",
    settings: { path: "", repairMode: "off" },
    automatic: false,
  });
  expect(view.container.textContent).toContain("Fix the JSON to see suggestions");
  await fill(field("JSON input"), '{"active":false}');
  await fill(field("JSONPath"), "act");
  await act(() => field("JSONPath").focus());
  await waitFor(() => expect(document.querySelector('[role="option"]')?.textContent).toContain("active"));
  expect(view.container.textContent).not.toContain("Fix the JSON");
});
test.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])(
  "JSON path modified Enter does not submit: %j",
  async (options) => {
    const view = await mountWorkspace(PathWorkspace, pathDefinition, queryJson, {
      text: '{"name":"Ada"}',
      settings: { path: "name" },
      automatic: false,
    });
    await press(field("JSONPath"), "Enter", options);
    expect(view.onRun).not.toHaveBeenCalled();
  },
);

test("JSON path keyboard suggestion selection does not run until the next Enter", async () => {
  const view = await mountWorkspace(PathWorkspace, pathDefinition, queryJson, {
    text: '{"users":[{"name":"Ada"}]}',
    settings: { path: "" },
    automatic: false,
  });
  const input = field("JSONPath");
  await fill(input, "users[0].na");
  await act(() => input.focus());
  await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("true"));
  await press(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
  await press(input, "Enter");
  expect(view.state.settings.path).toBe("users[0].name");
  expect(view.onRun).not.toHaveBeenCalled();
  await press(input, "Enter");
  await waitFor(() => expect(view.state.result?.text).toBe('"Ada"'));
  expect(view.onRun).toHaveBeenCalledTimes(1);
});
