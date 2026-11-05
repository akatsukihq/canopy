import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("markdown-to-html");
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
  const source = "<script>alert(1)</script>\n\n# Hello 😀\n\n[Safe](https://example.test)";
  await fill(field(definition.input.label), source);
  await openSettings();
  await click(field("Sanitize HTML"));
  await click(field("Open links safely"));
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy all")).toBeTruthy());
  await click(button("Copy all"));
  expect(clipboard.writeText.mock.calls.at(-1)[0]).not.toContain("<script>");
  expect(clipboard.writeText.mock.calls.at(-1)[0]).toContain("<h1>Hello 😀</h1>");
  expect(clipboard.writeText.mock.calls.at(-1)[0]).toContain('target="_blank" rel="noopener noreferrer"');
});
