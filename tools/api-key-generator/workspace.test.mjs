import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("api-key-generator");
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

test("API key workspace changes prefix/environment/count and recovers from an invalid prefix", async () => {
  vi.stubGlobal("crypto", { getRandomValues: (values) => values.fill(0) });
  const view = await mountWorkspace(definition, run);
  await fill(field("Prefix"), "pk");
  await fill(field("Length"), "8");
  await fill(field("How many"), "2");
  await choose("Environment", "Production");
  await choose("Character set", "Alphanumeric");
  await click(field("Avoid ambiguous chars"));
  await execute();
  assert.equal(await copied(), "pk_live_AAAAAAAA\npk_live_AAAAAAAA");
  await fill(field("Prefix"), "bad prefix!");
  await execute();
  assert.ok(view.container.textContent.includes("Prefix may contain only letters, numbers, underscores, and hyphens."));
  await fill(field("Prefix"), "");
  await execute();
  assert.equal(await copied(), "live_AAAAAAAA\nlive_AAAAAAAA");
});
