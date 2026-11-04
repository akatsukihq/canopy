import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Blob as NodeBlob } from "node:buffer";
import React, { act, useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("diagram-generator");
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
const diagramPng = vi.hoisted(() => vi.fn());
vi.mock("@/lib/markdown/diagramExport", () => ({ diagramPng }));
setupReactTools();

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>你好 → Café &amp; 👋</text></svg>';
const result = { render: "html", html: svg, downloadName: "diagram.svg" };

function Fixture({ result: output = result, error, onInputChange = () => {} }) {
  const [input, setInput] = useState({ text: "flowchart LR\n A-->B", files: [] });
  return React.createElement(Workspace, {
    spec: definition,
    settings: {},
    input,
    result: output,
    error,
    lifecycle: error ? "failed" : output ? "completed" : "ready",
    onSettingChange() {},
    onInputChange(next) {
      setInput(next);
      onInputChange(next);
    },
  });
}

async function openDownloads() {
  const trigger = document.querySelector('button[aria-haspopup="menu"]');
  assert.ok(trigger);
  await act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
}

test("diagram workspace edits Mermaid source and copies exact SVG rather than its source", async () => {
  const onInputChange = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await mountTool(React.createElement(Fixture, { onInputChange }), { spec: definition });
  await fill(field("Mermaid diagram code"), "sequenceDiagram\n Alice->>Bob: Hello");
  assert.equal(onInputChange.mock.calls.at(-1)[0].text, "sequenceDiagram\n Alice->>Bob: Hello");
  await click(button("Copy SVG"));
  assert.deepEqual(writeText.mock.calls, [[svg]]);
});

test("diagram workspace downloads exact SVG and prepares PNG only after choosing PNG", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const blobs = [];
  const downloads = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:diagram-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push(this.download);
  });
  diagramPng.mockReset().mockResolvedValue(new NodeBlob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  await mountTool(React.createElement(Fixture), { spec: definition });
  await openDownloads();
  assert.equal(diagramPng.mock.calls.length, 0);
  await click([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "diagram.svg"));
  assert.deepEqual(downloads, ["diagram.svg"]);
  assert.equal(await blobs[0].text(), svg);
  assert.equal(blobs[0].type, "image/svg+xml;charset=utf-8");
  assert.equal(diagramPng.mock.calls.length, 0);
  await openDownloads();
  await click([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "diagram.png"));
  assert.deepEqual(diagramPng.mock.calls, [[svg]]);
  assert.deepEqual(downloads, ["diagram.svg", "diagram.png"]);
  assert.equal(blobs[1].type, "image/png");
  assert.deepEqual(new Uint8Array(await blobs[1].arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
});

test("diagram workspace keeps source available after a render error and restores export actions with a valid result", async () => {
  const onInputChange = vi.fn();
  const view = await mountTool(
    React.createElement(Fixture, {
      result: null,
      error: "Mermaid diagram is invalid: unexpected token",
      onInputChange,
    }),
    { spec: definition },
  );
  assert.ok(view.container.textContent.includes("Mermaid diagram is invalid"));
  assert.equal(Boolean(button("Copy SVG")), false);
  await fill(field("Mermaid diagram code"), "flowchart TD\n Start-->Finish");
  assert.equal(onInputChange.mock.calls.at(-1)[0].text, "flowchart TD\n Start-->Finish");
  await view.rerender(React.createElement(Fixture, { result }));
  assert.ok(button("Copy SVG"));
  assert.ok(!view.container.textContent.includes("Mermaid diagram is invalid"));
});
