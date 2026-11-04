import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("basic-auth-generator");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
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

test("Basic Auth preserves credentials when switching formats and copies the selected output", async () => {
  await mountWorkspace(definition, run, Workspace);
  await fill(field(/^Username/), "Ada");
  await fill(field("Password or API secret (optional)"), "secret");
  for (const [format, expected] of [
    ["Authorization header", "Authorization: Basic QWRhOnNlY3JldA=="],
    ["Header value", "Basic QWRhOnNlY3JldA=="],
    ["Base64 token", "QWRhOnNlY3JldA=="],
    ["cURL command", "curl --header 'Authorization: Basic QWRhOnNlY3JldA==' 'https://example.com/api'"],
    [
      "JavaScript fetch",
      'await fetch("https://example.com/api", {\n  headers: {\n    Authorization: "Basic QWRhOnNlY3JldA==",\n  },\n});',
    ],
  ]) {
    await choose("Output format", format);
    assert.equal(field(/^Username/).value, "Ada");
    assert.equal(field("Password or API secret (optional)").value, "secret");
    assert.equal(field("Password or API secret (optional)").type, "password");
    await click(button("Run test operation"));
    await click(button("Copy all"));
    assert.equal(writeText.mock.calls.at(-1)[0], expected);
  }
});

test("Basic Auth rejects an ambiguous username and can recover without losing the password", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "Ada:admin", secondary: "secret" });
  await click(button("Run test operation"));
  assert.ok(view.container.textContent.includes("Username cannot contain a colon (:)."));
  assert.equal(button("Copy all").disabled, true);
  await fill(field(/^Username/), "Ada");
  await click(button("Run test operation"));
  await click(button("Copy all"));
  assert.equal(writeText.mock.calls.at(-1)[0], "Authorization: Basic QWRhOnNlY3JldA==");
});
