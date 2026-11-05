import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("random-number-generator");
import { run } from "./run.ts";
import { setupReactTools, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();
let writeText;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});
const execute = () => click(button("Run test operation"));
async function copied() {
  await click(button("Copy all"));
  return writeText.mock.calls.at(-1)[0];
}

test("random number workspace applies seed, decimal mode, uniqueness, count and sorting", async () => {
  await mountWorkspace(definition, run);
  await fill(field("Min"), "10");
  await fill(field("Max"), "99");
  await fill(field("How many"), "6");
  await fill(field("Seed"), "smarttools-2025");
  await click(field("Whole numbers"));
  await click(field("Unique values"));
  await click(field("Sort result"));
  await execute();
  assert.equal(await copied(), "23.89\n25.99\n26.76\n37.21\n57.13\n75.07");
  await choose("Decimal places", "4 places");
  await execute();
  const values = (await copied()).split("\n");
  assert.equal(values.length, 6);
  assert.ok(values.every((value) => /^\d{2}\.\d{4}$/.test(value)));
  assert.deepEqual(
    values.map(Number),
    values.map(Number).sort((a, b) => a - b),
  );
});

test("random number workspace explains an impossible unique count and recovers after widening the range", async () => {
  const view = await mountWorkspace(definition, run);
  await fill(field("Min"), "1");
  await fill(field("Max"), "2");
  await fill(field("How many"), "3");
  await fill(field("Seed"), "recover");
  await click(field("Unique values"));
  await click(field("Sort result"));
  await execute();
  assert.ok(view.container.textContent.includes("The range does not contain enough unique values."));
  const unavailableCopy = button("Copy all");
  assert.equal(unavailableCopy?.disabled, true, "Copy stays disabled until a valid result exists");
  await click(unavailableCopy);
  assert.equal(writeText.mock.calls.length, 0, "Invalid results cannot write to the clipboard");
  await fill(field("Max"), "3");
  await execute();
  assert.equal(await copied(), "1\n2\n3");
  assert.ok(!view.container.textContent.includes("The range does not contain enough unique values."));
});
