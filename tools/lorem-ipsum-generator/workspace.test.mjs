import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("lorem-ipsum-generator");
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

test("lorem-ipsum-generator: custom sentence setting appears when selected and copies one exact paragraph", async () => {
  await mountWorkspace(spec, run, Workspace);
  expect(field("Sentences per paragraph")).toBeUndefined();
  await choose("Paragraph length", "Custom");
  await fill(field("Sentences per paragraph"), "1");
  await fill(field("Paragraphs"), "2");
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy paragraph 2")).toBeTruthy());
  await click(button("Copy paragraph 2"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith(
    "Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus.",
  );
  await choose("Paragraph length", "Short");
  expect(field("Sentences per paragraph")).toBeUndefined();
});
