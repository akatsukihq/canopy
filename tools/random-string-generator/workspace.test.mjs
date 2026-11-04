import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("random-string-generator");
import { run } from "./run.ts";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose } from "../../tests/helpers/tool-workspace.mjs";

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
  const source = "";

  await choose("Character set", "Hex");
  await fill(field("Length"), "8");
  await fill(field("How many"), "2");
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy all")).toBeTruthy());
  await click(button("Copy all"));
  expect(clipboard.writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^[0-9a-f]{8}\n[0-9a-f]{8}$/));
});
