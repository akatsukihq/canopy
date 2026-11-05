import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("find-and-replace");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();
const spec = definition;
let clipboard;
beforeEach(() => {
  clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "pasted 😀") };
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: clipboard }));
});

test("find-and-replace: source and replacement edits update match count, output, and exact copy", async () => {
  const view = await mountWorkspace(spec, run, Workspace, { text: "staging and staging" });
  expect(button("Apply 2 replacements").disabled).toBe(false);
  await fill(field("Replace with"), "release 😀");
  await click(button("Apply 2 replacements"));
  await waitFor(() => expect(view.container.textContent).toContain("release 😀 and release 😀"));
  await click(button("Copy all"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith("release 😀 and release 😀");
  await fill(field("Source text"), "staging only");
  expect(button("Apply 1 replacement")).toBeTruthy();
});

test("find-and-replace: missing find, invalid regex, and no matches block execution until recovered", async () => {
  const view = await mountWorkspace(spec, run, Workspace, { text: "hello world" });
  await fill(field("Find"), "");
  expect(view.container.querySelector('[role="alert"]').textContent).toContain("Enter the text or pattern");
  expect(button("Apply replacements").disabled).toBe(true);
  await openSettings();
  await click(field("Regex"));
  await fill(field("Find"), "[");
  expect(view.container.querySelector('[role="alert"]').textContent).toContain("valid regular expression");
  await fill(field("Find"), "unmatched");
  expect(button("Apply replacements").disabled).toBe(true);
  expect(view.container.textContent).toContain("No matches were found");
  await fill(field("Find"), "world");
  expect(button("Apply 1 replacement").disabled).toBe(false);
});
