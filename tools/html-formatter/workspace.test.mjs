import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("html-formatter");
import { run } from "./run.ts";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();
let clipboard;
beforeEach(() => {
  clipboard = { writeText: vi.fn(async () => {}) };
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: clipboard }));
});

test("editing source and settings changes the real result and exact copy", async () => {
  const view = await mountWorkspace(definition, run);
  const source = "<div><p>hello 😀</p></div>";
  await fill(field(definition.input.label), source);
  await openSettings();
  await choose("Indent width", "4 spaces");
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy all")).toBeTruthy());
  await click(button("Copy all"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith("<div>\n    <p>\n        hello 😀\n    </p>\n</div>");
});
