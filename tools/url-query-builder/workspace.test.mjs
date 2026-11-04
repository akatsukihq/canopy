import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("url-query-builder");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace } from "../../tests/helpers/tool-workspace.mjs";

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
const key = (index) => field(`Parameter key ${index}`);
const value = (index) => field(`Value ${index}`);
async function copied() {
  await click(button("Copy all") ?? button("Copied"));
  return writeText.mock.calls.at(-1)[0];
}

test("URL query rows add, edit, remove, and copy the exact generated URL", async () => {
  await mountWorkspace(definition, run, Workspace);
  assert.equal(key(1).value, "");
  assert.equal(value(1).value, "");
  await fill(field(/^Base URL/), "https://example.com/search");
  await fill(key(1), "q");
  await fill(value(1), "smart tools");
  await click(button("Add parameter"));
  await fill(key(2), "tag");
  await fill(value(2), "web");
  await execute();
  assert.equal(await copied(), "https://example.com/search?q=smart+tools&tag=web");

  await fill(value(1), "updated query");
  await click(button("Remove parameter 2"));
  await execute();
  assert.equal(await copied(), "https://example.com/search?q=updated+query");

  await click(button("Remove parameter 1"));
  assert.equal(key(1).value, "", "Removing the last row leaves an editable blank row");
  await execute();
  assert.equal(await copied(), "https://example.com/search");
});

test("URL bulk imports preserve repeated keys, equals signs, the base query, and fragment", async () => {
  await mountWorkspace(definition, run, Workspace, { text: "https://example.com/search?existing=keep#results" });
  await click(button("Paste multiple"));
  await fill(field("Parameters to paste"), "tag=dev\ntag=web\nfilter=a=b=c");
  await click(button("Add parameters"));
  await execute();
  assert.equal(await copied(), "https://example.com/search?existing=keep&tag=dev&tag=web&filter=a%3Db%3Dc#results");
});

test("URL legacy text and saved rows become one editable list without duplication or reordering", async () => {
  await mountWorkspace(definition, run, Workspace, {
    text: "https://example.com/search",
    secondary: "tag=dev\ntag=web",
    settings: { parameters: [{ key: "q", value: "saved query" }] },
  });
  assert.equal(key(1).value, "tag");
  assert.equal(value(1).value, "dev");
  assert.equal(key(2).value, "tag");
  assert.equal(value(2).value, "web");
  assert.equal(key(3).value, "q");
  assert.equal(value(3).value, "saved query");
  await execute();
  assert.equal(await copied(), "https://example.com/search?tag=dev&tag=web&q=saved+query");

  await fill(value(2), "mobile");
  await execute();
  assert.equal(await copied(), "https://example.com/search?tag=dev&tag=mobile&q=saved+query");
  await click(button("Remove parameter 1"));
  await execute();
  assert.equal(await copied(), "https://example.com/search?tag=mobile&q=saved+query");
});

test("URL invalid bulk import stays editable and does not discard existing rows", async () => {
  const view = await mountWorkspace(definition, run, Workspace, {
    text: "https://example.com/search",
    settings: { parameters: [{ key: "existing", value: "keep" }] },
  });
  await click(button("Paste multiple"));
  await fill(field("Parameters to paste"), "tag=dev\nbroken line");
  await click(button("Add parameters"));
  assert.equal(field("Parameters to paste").value, "tag=dev\nbroken line");
  assert.equal(field("Parameters to paste").getAttribute("aria-invalid"), "true");
  assert.ok(view.container.textContent.includes("Each line needs a parameter key followed by = and its value."));
  assert.equal(key(1).value, "existing");
  assert.equal(value(1).value, "keep");

  await fill(field("Parameters to paste"), "tag=dev\ntag=web");
  await click(button("Add parameters"));
  assert.equal(field("Parameters to paste"), undefined);
  await execute();
  assert.equal(await copied(), "https://example.com/search?existing=keep&tag=dev&tag=web");
});

test("URL invalid legacy text is recoverable before saved rows without losing either source", async () => {
  await mountWorkspace(definition, run, Workspace, {
    text: "https://example.com/search",
    secondary: "broken line\ntag=imported",
    settings: { parameters: [{ key: "saved", value: "keep" }] },
  });
  assert.equal(field("Parameters to paste").value, "broken line\ntag=imported");
  assert.equal(key(1).value, "saved");
  assert.equal(value(1).value, "keep");
  assert.equal(key(1).disabled, true);
  assert.equal(value(1).disabled, true);
  assert.equal(button("Add parameter").disabled, true);
  await fill(field("Parameters to paste"), "fixed=first\ntag=imported");
  await click(button("Apply parameters"));
  assert.equal(key(1).disabled, false);
  await execute();
  assert.equal(await copied(), "https://example.com/search?fixed=first&tag=imported&saved=keep");
});

test("URL malformed legacy text can be cleared while preserving saved parameters", async () => {
  await mountWorkspace(definition, run, Workspace, {
    text: "https://example.com/search",
    secondary: "broken line\ntag=unwanted",
    settings: { parameters: [{ key: "saved", value: "keep" }] },
  });
  await fill(field("Parameters to paste"), "");
  await click(button("Apply parameters"));
  assert.equal(field("Parameters to paste"), undefined);
  assert.equal(key(1).value, "saved");
  assert.equal(value(1).value, "keep");
  assert.equal(key(1).disabled, false);
  assert.equal(button("Add parameter").disabled, false);
  assert.equal(key(2), undefined);
  await execute();
  assert.equal(await copied(), "https://example.com/search?saved=keep");
});

test("URL bulk paste moves keyboard focus into the editor and restores a useful control afterward", async () => {
  await mountWorkspace(definition, run, Workspace, {
    text: "https://example.com/search",
    settings: { parameters: [{ key: "saved", value: "keep" }] },
  });
  await click(button("Paste multiple"));
  assert.equal(document.activeElement, field("Parameters to paste"));
  await fill(field("Parameters to paste"), "tag=discarded");
  await click(button("Cancel"));
  assert.equal(document.activeElement, button("Paste multiple"));
  assert.equal(key(2), undefined, "Cancel does not import the draft");

  await click(button("Paste multiple"));
  assert.equal(document.activeElement, field("Parameters to paste"));
  assert.equal(field("Parameters to paste").value, "");
  await fill(field("Parameters to paste"), "tag=dev\ntag=web");
  await click(button("Add parameters"));
  assert.equal(document.activeElement, key(2), "Focus lands on the first imported key after existing rows");
  assert.equal(key(2).value, "tag");
  assert.equal(value(2).value, "dev");
});
