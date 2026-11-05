import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { test, vi } from "vitest";
const definition = await toolSpec("json-schema-validator");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { testJsonWorkspace } from "../../tests/helpers/json-generic-workspace.mjs";
import { mountWorkspace } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();
testJsonWorkspace(definition, run, {
  source: '{"age":18}',
  secondary: '{"type":"object","properties":{"age":{"type":"integer"}}}',
  expected: "Valid against schema.",
  invalid: "not JSON",
});

const schema = '{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"age":{"type":"integer"}}}';
const validData = '{"name":"Ada","age":36}';

async function selectView(name) {
  await act(() => button(name).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  assert.equal(button(name).getAttribute("aria-selected"), "true");
}

function recordClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
  return writeText;
}

function reportCounts(container) {
  return Object.fromEntries(
    [...container.querySelectorAll("dt")].map((term) => [term.textContent, term.nextElementSibling.textContent]),
  );
}

test("validation opens a readable report while report and raw views copy the exact result", async () => {
  const writeText = recordClipboard();
  const view = await mountWorkspace(definition, run, Workspace, { text: validData, secondary: schema });
  await click(button("Run test operation"));
  assert.equal(button("Report").getAttribute("aria-selected"), "true");
  assert.ok(view.container.textContent.includes("All supported checks passed"));
  assert.ok(view.container.textContent.includes("Checks performed"));
  assert.deepEqual(reportCounts(view.container), {
    "Checks passed": "4",
    "Checks failed": "0",
    "Values visited": "3",
  });

  for (const mode of ["Report", "Raw", "Report"]) {
    await selectView(mode);
    assert.equal(view.container.textContent.includes("All supported checks passed"), mode === "Report");
    await click(button(/^(Copy all|Copied)$/));
    assert.equal(writeText.mock.calls.at(-1)[0], "Valid against schema.");
  }
});

test("failed validation shows each problem and preserves the exact copyable error output", async () => {
  const writeText = recordClipboard();
  const view = await mountWorkspace(definition, run, Workspace, {
    text: '{"age":"eighteen"}',
    secondary: schema,
  });
  await click(button("Run test operation"));
  assert.ok(view.container.textContent.includes("JSON does not match the schema"));
  assert.ok(view.container.textContent.includes("Problems to fix"));
  assert.ok(view.container.textContent.includes("$.name: is required"));
  assert.ok(view.container.textContent.includes("$.age: expected integer, received string"));
  assert.deepEqual(reportCounts(view.container), {
    "Checks passed": "1",
    "Checks failed": "2",
    "Values visited": "2",
  });
  await click(button("Copy all"));
  assert.equal(
    writeText.mock.calls.at(-1)[0],
    "Invalid\n- $.name: is required\n- $.age: expected integer, received string",
  );
});

test("editing inputs clears the obsolete report and malformed data can be corrected and revalidated", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: validData, secondary: schema });
  await click(button("Run test operation"));
  assert.ok(view.container.textContent.includes("All supported checks passed"));

  await fill(field("JSON data"), "not JSON");
  assert.ok(!view.container.textContent.includes("All supported checks passed"));
  assert.equal(button("Copy all")?.disabled ?? true, true);
  await click(button("Run test operation"));
  await waitFor(() => assert.ok(view.container.textContent.includes("Unable to create the result")));

  await fill(field("JSON data"), validData);
  await click(button("Run test operation"));
  await waitFor(() => assert.ok(view.container.textContent.includes("All supported checks passed")));
  assert.ok(!view.container.textContent.includes("Unable to create the result"));
  assert.equal(button("Copy all").disabled, false);

  await fill(field("JSON schema"), '{"type":"array"}');
  assert.ok(!view.container.textContent.includes("All supported checks passed"));
  assert.equal(button("Copy all")?.disabled ?? true, true);
  await click(button("Run test operation"));
  assert.ok(view.container.textContent.includes("JSON does not match the schema"));
  assert.ok(view.container.textContent.includes("$: expected array, received object"));
});

test("unsupported-only schemas explain that no supported checks ran", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "18", secondary: '{"minimum":21}' });
  await click(button("Run test operation"));
  assert.ok(view.container.textContent.includes("No supported checks to run"));
  assert.ok(view.container.textContent.includes("Rules not evaluated"));
  assert.ok(view.container.textContent.includes("minimum"));
  assert.ok(!view.container.textContent.includes("All supported checks passed"));
});
