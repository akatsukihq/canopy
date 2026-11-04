import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Blob as NodeBlob } from "node:buffer";
import React, { act } from "react";
import { beforeEach, test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("qr-code-generator");
import { run } from "./run.ts";
import { setupReactTools, mountTool, click, button, waitFor } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

const settings = Object.fromEntries(
  Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default]),
);
let blobs, downloads;
beforeEach(() => {
  blobs = [];
  downloads = [];
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:qr-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push(this.download);
  });
});

function Fixture({ result }) {
  return React.createElement(Workspace, {
    spec: definition,
    settings,
    input: { text: "https://example.com", files: [] },
    result,
    lifecycle: result ? "completed" : "ready",
    onInputChange() {},
    onSettingChange() {},
  });
}

async function generate(text = "https://example.com") {
  return run({ input: { text }, settings, signal: new AbortController().signal });
}

async function openDownloads() {
  const trigger = button("Download format");
  assert.ok(trigger);
  assert.equal(trigger.disabled, false);
  await act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
}

function downloadOption(name) {
  return [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === name);
}

test("QR preview exports exact PNG and SVG files from the shared download menu", async () => {
  const result = await generate();
  const { container } = await mountTool(React.createElement(Fixture, { result }));
  assert.equal(container.querySelector("img").getAttribute("src"), result.src);
  await openDownloads();
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ["qr-code.png", "qr-code.svg"],
  );
  await click(downloadOption("qr-code.svg"));
  assert.deepEqual(downloads, ["qr-code.svg"]);
  assert.equal(blobs[0].type, "image/svg+xml;charset=utf-8");
  assert.equal(await blobs[0].text(), result.artifacts[0].content);

  await openDownloads();
  await click(downloadOption("qr-code.png"));
  await waitFor(() => assert.deepEqual(downloads, ["qr-code.svg", "qr-code.png"]));
  assert.equal(blobs[1].type, "image/png");
  assert.deepEqual(Buffer.from(await blobs[1].arrayBuffer()), Buffer.from(result.src.split(",")[1], "base64"));
  assert.equal(container.querySelector("img").getAttribute("src"), result.src);
});

test("replacing or clearing a QR result closes the previous menu and only exposes current files", async () => {
  const result = await generate();
  const replacement = await generate("Replacement QR content");
  const view = await mountTool(React.createElement(Fixture, { result }));
  await openDownloads();
  assert.ok(downloadOption("qr-code.svg"));
  await view.rerender(React.createElement(Fixture, { result: replacement }));
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(view.container.querySelector("img").getAttribute("src"), replacement.src);
  await openDownloads();
  await click(downloadOption("qr-code.svg"));
  assert.equal(await blobs[0].text(), replacement.artifacts[0].content);

  await openDownloads();
  await view.rerender(React.createElement(Fixture, { result: null }));
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(button("Download format"), undefined);
  assert.deepEqual(downloads, ["qr-code.svg"]);
});

test("a pending PNG export cannot download after its QR result is cleared", async () => {
  const result = await generate();
  let finishFetch;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finishFetch = resolve;
      }),
  );
  const view = await mountTool(React.createElement(Fixture, { result }));
  await openDownloads();
  await click(downloadOption("qr-code.png"));
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls[0][0], result.src);
  await view.rerender(React.createElement(Fixture, { result: null }));
  await act(async () =>
    finishFetch({
      ok: true,
      blob: async () => new NodeBlob([Buffer.from(result.src.split(",")[1], "base64")], { type: "image/png" }),
    }),
  );
  assert.deepEqual(downloads, []);
  assert.deepEqual(blobs, []);
});
