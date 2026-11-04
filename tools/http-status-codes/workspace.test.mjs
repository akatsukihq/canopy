import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("http-status-codes");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";

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
const noMatch = "No matching HTTP status code was found.";
async function copied(label = "Copy all") {
  const action = button(label) ?? (label === "Copy all" ? button("Copied") : undefined);
  await click(action);
  return writeText.mock.calls.at(-1)[0];
}

test("HTTP status lookup opens 404 details while copying only the exact status line", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "404" });
  await execute();
  assert.equal(button("Details").getAttribute("aria-selected"), "true");
  assert.ok(view.container.textContent.includes("404"));
  assert.ok(view.container.textContent.includes("Not Found"));
  assert.ok(view.container.textContent.includes("4xx · Client error"));
  assert.ok(view.container.textContent.includes("could not find the requested resource"));
  assert.ok(view.container.textContent.includes("Check the URL, route, and resource ID"));
  assert.equal(await copied(), "404 Not Found");

  await act(() => button("Raw").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  assert.equal(button("Raw").getAttribute("aria-selected"), "true");
  assert.equal(await copied(), "404 Not Found");
});

test("HTTP status phrase matches offer independent copy actions and preserve Copy all", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "gateway" });
  await execute();
  assert.ok(view.container.textContent.includes("Bad Gateway"));
  assert.ok(view.container.textContent.includes("Gateway Timeout"));
  assert.equal(await copied("Copy 502"), "502 Bad Gateway");
  assert.equal(await copied("Copy 504"), "504 Gateway Timeout");
  assert.equal(await copied(), "502 Bad Gateway\n504 Gateway Timeout");
});

test("HTTP status category filtering reports no match and recovers with a matching category", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "timeout" });
  await choose("Category", "4xx · Client error");
  await execute();
  assert.equal(await copied(), "408 Request Timeout");

  await choose("Category", "2xx · Success");
  await execute();
  assert.ok(view.container.textContent.includes(noMatch));
  assert.equal(button("Copy all").disabled, true);
  await click(button("Copy all"));
  assert.equal(writeText.mock.calls.length, 1, "A failed lookup cannot copy the earlier category's result");

  await choose("Category", "5xx · Server error");
  await execute();
  assert.equal(await copied(), "504 Gateway Timeout");
  assert.ok(!view.container.textContent.includes(noMatch));
});

test("HTTP status search mode respects code and phrase queries and allows correction", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: "not found" });
  await openSettings();
  await choose("Search mode", "Code only");
  await execute();
  assert.ok(view.container.textContent.includes(noMatch));
  assert.equal(button("Copy all").disabled, true);

  await fill(field(/^Status code or phrase/), "404");
  await execute();
  assert.equal(await copied(), "404 Not Found");
  assert.ok(!view.container.textContent.includes(noMatch));

  await choose("Search mode", "Phrase only");
  await execute();
  assert.ok(view.container.textContent.includes(noMatch));
  await fill(field(/^Status code or phrase/), "not found");
  await execute();
  assert.equal(await copied(), "404 Not Found");
  assert.ok(!view.container.textContent.includes(noMatch));
});
