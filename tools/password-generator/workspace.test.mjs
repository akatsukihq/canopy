import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("password-generator");
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

test("password-generator: controls block an empty alphabet and recover with numeric-only output", async () => {
  const view = await mountWorkspace(spec, run, Workspace);
  for (const label of ["Uppercase A–Z", "Lowercase a–z", "Numbers 0–9", "Symbols !@#$"]) await click(field(label));
  expect(button("Generate 4 passwords").disabled).toBe(true);
  await click(field("Numbers 0–9"));
  await fill(field("How many"), "1");
  await fill(field("Password length"), "8");
  expect(button("Generate 1 password").disabled).toBe(false);
  await click(button("Generate 1 password"));
  await waitFor(() => expect(button("Copy all", view.container)).toBeTruthy());
  await click(button("Copy all", view.container));
  expect(clipboard.writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{8}$/));
});
