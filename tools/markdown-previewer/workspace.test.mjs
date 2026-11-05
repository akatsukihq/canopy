import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("markdown-previewer");
import { run, renderMarkdownPreview } from "./run.worker.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field, waitFor, mountTool } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";
import { parseSettings } from "../../lib/tool-framework/settings.ts";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));

setupReactTools();
let writeText;
let downloads;
let blobs;
let failNextExport;
let workers;

beforeEach(() => {
  failNextExport = false;
  workers = [];
  writeText = vi.fn(async () => {});
  downloads = [];
  blobs = [];
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:markdown-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push({ name: this.download, href: this.href });
  });
  // jsdom has no Worker. Only its transport is substituted: the actual worker
  // renderer still produces the exported document, including syntax highlighting.
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        workers.push(this);
      }
      terminate() {
        this.terminated = true;
      }
      postMessage(message) {
        Promise.resolve().then(async () => {
          if (failNextExport) {
            failNextExport = false;
            this.onmessage?.({ data: { id: message.id, error: "Export unavailable" } });
            return;
          }
          const result = await renderMarkdownPreview(message.source, message.settings, { deferHighlighting: false });
          if (!this.terminated) this.onmessage?.({ data: { id: message.id, html: result.html } });
        });
      }
    },
  );
});

test("editing Markdown and selecting CommonMark changes the exact exported HTML", async () => {
  await mountWorkspace(definition, run, Workspace);
  await fill(field("Markdown document"), "# café 😀\n\n~~removed~~");
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy")).toBeTruthy());
  await click(button("Copy"));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("<h1>café 😀</h1>\n<p><del>removed</del></p>\n"));
  await openSettings();
  await choose("Preview mode", "CommonMark");
  await click(button("Run test operation"));
  await click(button("Copy"));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("<h1>café 😀</h1>\n<p>~~removed~~</p>\n"));
});

test("deferred highlighted export copies and downloads the full generated document, then disposes the worker", async () => {
  const source = '# Example\n\n```js\nconst message = "😀";\n```\n\nFinal paragraph.';
  const view = await mountWorkspace(definition, run, Workspace, { text: source });
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy")).toBeTruthy());
  await click(button("Copy"));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const html = writeText.mock.calls[0][0];
  expect(html).toContain("hljs-keyword");
  expect(html).toContain("Final paragraph.");
  expect(html).toContain("😀");
  await click(button("Download"));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0].name).toBe("preview.html");
  expect(await blobs[0].text()).toBe(html);
  await view.unmount();
  expect(workers.every((worker) => worker.terminated)).toBe(true);
});

test("a failed Markdown export keeps copy available for a successful retry", async () => {
  await mountWorkspace(definition, run, Workspace, { text: "# Retry" });
  await click(button("Run test operation"));
  await waitFor(() => expect(button("Copy")).toBeTruthy());
  failNextExport = true;
  await click(button("Copy"));
  await waitFor(() => expect(button("Copy")?.disabled).toBe(false));
  expect(writeText).not.toHaveBeenCalled();
  await click(button("Copy"));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("<h1>Retry</h1>\n"));
});

test("clearing source removes retained preview and prevents copying the stale document", async () => {
  const settings = parseSettings(definition.settings, {});
  const result = await run({ input: { text: "# Original" }, settings, signal: new AbortController().signal });
  const props = {
    spec: definition,
    input: { text: "# Original", files: [] },
    settings,
    result,
    lifecycle: "completed",
    onInputChange() {},
    onSettingChange() {},
  };
  const view = await mountTool(React.createElement(Workspace, props), { spec: definition });
  expect(button("Copy")).toBeTruthy();
  await view.rerender(
    React.createElement(Workspace, { ...props, result: null, input: { text: "", files: [] }, lifecycle: "idle" }),
  );
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(button("Copy")?.disabled ?? true).toBe(true);
  expect(writeText).not.toHaveBeenCalled();
});
