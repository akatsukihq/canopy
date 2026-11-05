import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("text-diff-checker");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose } from "../../tests/helpers/tool-workspace.mjs";

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

test("text-diff-checker: input edits compare, copy exact diff, return to editing, and compare again", async () => {
  const view = await mountWorkspace(spec, run, Workspace);
  await fill(field("Original text"), "alpha\nbeta");
  await fill(field("Changed text"), "alpha\n😀");
  await click(button("Run test operation"));
  expect(view.container.textContent).toContain("1 line added · 1 line removed");
  await click(button("Copy all"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith("  alpha\n- beta\n+ 😀");
  await click(button("Edit text"));
  expect(field("Original text").value).toBe("alpha\nbeta");
  expect(field("Changed text").value).toBe("alpha\n😀");
  await fill(field("Changed text"), "alpha\nbeta");
  await click(button("Run test operation"));
  expect(view.container.textContent).toContain("No differences");
});

test("text-diff-checker: paste targets the selected side without overwriting the other input", async () => {
  await mountWorkspace(spec, run, Workspace, { text: "original", secondary: "changed" });
  await click(button("Paste into Changed text"));
  expect(field("Original text").value).toBe("original");
  expect(field("Changed text").value).toBe("pasted 😀");
});
