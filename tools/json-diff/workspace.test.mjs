import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { act } from "react";
import { expect, test, vi } from "vitest";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, selectView, press } from "../../tests/helpers/json-workspaces.mjs";
import DiffWorkspace from "./workspace.tsx";
const diffDefinition = await toolSpec("json-diff");
import { run as diffJson } from "./run.ts";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();

test("JSON diff shows directional changes and Edit JSON restores both original documents", async () => {
  const source = '{"name":"Ada"}';
  const candidate = '{"name":"Lin"}';
  const view = await mountWorkspace(DiffWorkspace, diffDefinition, diffJson, { text: source, secondary: candidate });
  await waitFor(() => expect(button("Edit JSON")).toBeTruthy());
  expect(view.container.textContent).toContain('"Ada"');
  expect(view.container.textContent).toContain('"Lin"');
  expect(view.container.textContent).toContain("1 line added · 1 line removed");
  await click(button("Edit JSON"));
  expect(field("JSON A").value).toBe(source);
  expect(field("JSON B").value).toBe(candidate);
  await fill(field("JSON B"), source);
  await waitFor(() => expect(view.container.textContent).toContain("No differences"));
});

test("JSON diff associates invalid candidate feedback with that input and recovers", async () => {
  const view = await mountWorkspace(DiffWorkspace, diffDefinition, diffJson, {
    text: "{}",
    secondary: "{",
    settings: { repairMode: "off" },
  });
  await waitFor(() => expect(field("JSON B")?.getAttribute("aria-invalid")).toBe("true"));
  expect(field("JSON A").getAttribute("aria-invalid")).toBe("false");
  expect(document.getElementById(field("JSON B").getAttribute("aria-describedby")).textContent).toContain("JSON B");
  await fill(field("JSON B"), "{}");
  await waitFor(() => expect(view.container.textContent).toContain("No differences"));
});
