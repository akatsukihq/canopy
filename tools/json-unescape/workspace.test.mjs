import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { vi } from "vitest";
const definition = await toolSpec("json-unescape");
import { run } from "./run.ts";
import { setupReactTools } from "../../tests/helpers/react-tools.mjs";
import { testJsonWorkspace } from "../../tests/helpers/json-generic-workspace.mjs";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
setupReactTools();
testJsonWorkspace(definition, run, {
  source: 'a\\"b\\n',
  expected: 'a"b\n',
  invalid: "\\x20",
});
