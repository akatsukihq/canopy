import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("slug-generator");
import { run } from "./run.ts";
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

test("editing the shared source reaches the real operation and copy action", async () => {
  const source = "Café hello";
  const output = "cafe-hello";
  await mountWorkspace(spec, run);
  await fill(field(spec.input.label), source);
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy all")).toBeTruthy());
  await click(button("Copy all"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith(output);
});
