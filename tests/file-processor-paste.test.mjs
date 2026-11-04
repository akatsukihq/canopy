import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React, { act, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileProcessorWorkspace } from "../components/FileProcessorWorkspace.tsx";
import { toast } from "../components/ui/index.tsx";
const imageToPdfSpec = await toolSpec("image-to-pdf");
import { button, click, mountTool, setupReactTools, waitFor } from "./helpers/react-tools.mjs";

vi.mock("../lib/tool-framework/hooks.ts", () => ({ loadToolHooks: async () => ({}) }));
vi.mock("../lib/tool-framework/useToolRun.ts", () => {
  const handle = {
    closeInspection: () => {},
    inspect: () => {},
    previews: [],
    requestThumbnails: () => {},
    reset: () => {},
    state: { status: "idle" },
  };
  return { useToolRun: () => handle };
});
vi.mock("../components/GeneratedPdfPreview.tsx", () => ({ GeneratedPdfPreview: () => null }));
vi.mock("../components/PdfPagesSurface.tsx", () => ({ PdfInspectionProvider: ({ children }) => children }));
vi.mock("../components/ResultView.tsx", () => ({ ResultView: () => null }));

setupReactTools();

const spec = { ...imageToPdfSpec, settings: { fields: {} } };
let readClipboard;
let reportError;
let clipboardDescriptor;

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:clipboard-test";
      }
      static revokeObjectURL() {}
    },
  );
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  readClipboard = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: readClipboard } });
  reportError = vi.spyOn(toast, "error").mockImplementation(() => "clipboard-error");
});

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete navigator.clipboard;
});

function imageFile(name = "existing.png", content = "existing", type = "image/png") {
  return new File([content], name, { type });
}

function clipboardItem(types = ["image/png"], content = "pasted") {
  return {
    types,
    getType: vi.fn(async (type) => new Blob([content], { type })),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function mountWorkspace({ files = [], ...overrides } = {}) {
  let currentInput;
  let replaceInput;
  let currentProps = overrides;
  const onInputChange = vi.fn();
  function Fixture(props) {
    const [input, setInput] = useState({ text: "", secondary: "", files });
    currentInput = input;
    replaceInput = setInput;
    return React.createElement(FileProcessorWorkspace, {
      spec,
      settings: {},
      input,
      result: null,
      lifecycle: "idle",
      onSettingChange: () => {},
      onInputChange: (next) => {
        onInputChange(next);
        setInput(next);
      },
      ...props,
    });
  }
  const view = await mountTool(React.createElement(Fixture, currentProps));
  return {
    ...view,
    onInputChange,
    get files() {
      return currentInput.files;
    },
    async update(next) {
      currentProps = { ...currentProps, ...next };
      await view.rerender(React.createElement(Fixture, currentProps));
    },
    async replaceFiles(next) {
      await act(async () => replaceInput({ ...currentInput, files: next }));
    },
  };
}

async function pasteFiles(target, files) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  await act(async () => target.dispatchEvent(event));
  return event;
}

test("Paste adds an image to empty input and appends subsequent clipboard images", async () => {
  const workspace = await mountWorkspace();
  readClipboard.mockResolvedValue([clipboardItem()]);
  await click(button("Paste", workspace.container));
  await waitFor(() => expect(workspace.files).toHaveLength(1));
  const first = workspace.files[0];
  expect(first).toBeInstanceOf(File);
  expect(first.type).toBe("image/png");
  expect(first.name).toMatch(/\.png$/);
  expect(await first.text()).toBe("pasted");

  readClipboard.mockResolvedValue([clipboardItem(["image/jpeg"], "second")]);
  await click(button("Paste", workspace.container));
  await waitFor(() => expect(workspace.files).toHaveLength(2));
  expect(workspace.files[0]).toBe(first);
  expect(workspace.files[1].type).toBe("image/jpeg");
  expect(await workspace.files[1].text()).toBe("second");
  expect(reportError).not.toHaveBeenCalled();
});

test("Paste reads only the first image representation of each clipboard item", async () => {
  const first = clipboardItem(["text/html", "image/png", "image/jpeg"], "first");
  const second = clipboardItem(["image/webp", "image/png"], "second");
  const text = clipboardItem(["text/plain"], "ignored");
  readClipboard.mockResolvedValue([first, text, second]);
  const workspace = await mountWorkspace();
  await click(button("Paste", workspace.container));
  await waitFor(() => expect(workspace.files).toHaveLength(2));
  expect(first.getType).toHaveBeenCalledExactlyOnceWith("image/png");
  expect(second.getType).toHaveBeenCalledExactlyOnceWith("image/webp");
  expect(text.getType).not.toHaveBeenCalled();
  expect(workspace.files.map((file) => file.type)).toEqual(["image/png", "image/webp"]);
});

test.each([
  { input: { maxFiles: 1 }, type: "image/png", content: "ok", issue: /Only 1 file/ },
  { input: { maxBytes: 2 }, type: "image/png", content: "large", issue: /exceeds the 2 byte limit/ },
  { input: { maxTotalBytes: 3 }, type: "image/png", content: "more", issue: /total 3 bytes or less/ },
  { input: { accept: "image/png" }, type: "image/jpeg", content: "ok", issue: /not an accepted file type/ },
])("Paste applies file selection validation: $issue", async ({ input, type, content, issue }) => {
  const existing = imageFile("existing.png", "a");
  const workspace = await mountWorkspace({ files: [existing], spec: { ...spec, input: { ...spec.input, ...input } } });
  readClipboard.mockResolvedValue([clipboardItem([type], content)]);
  await click(button("Paste", workspace.container));
  await waitFor(() => expect(workspace.container.textContent).toMatch(issue));
  expect(workspace.files).toEqual([existing]);
});

test.each([{ items: [] }, { items: [clipboardItem(["text/plain"])] }])(
  "Paste reports a clipboard without images",
  async ({ items }) => {
    const workspace = await mountWorkspace({ files: [imageFile()] });
    readClipboard.mockResolvedValue(items);
    await click(button("Paste", workspace.container));
    await waitFor(() => expect(reportError).toHaveBeenCalledOnce());
    expect(reportError.mock.calls[0][0]).toMatch(/No image.*clipboard/);
    expect(reportError.mock.calls[0][0]).toMatch(/Copy an image/);
    expect(workspace.onInputChange).not.toHaveBeenCalled();
  },
);

test.each(["unsupported", "read-denied", "image-unreadable"])("Paste handles %s clipboard access", async (failure) => {
  const workspace = await mountWorkspace();
  if (failure === "unsupported")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  else if (failure === "read-denied") readClipboard.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  else {
    const item = clipboardItem();
    item.getType.mockRejectedValue(new Error("The image cannot be read"));
    readClipboard.mockResolvedValue([item]);
  }
  await click(button("Paste", workspace.container));
  await waitFor(() => expect(reportError).toHaveBeenCalledOnce());
  expect(workspace.onInputChange).not.toHaveBeenCalled();
});

test("pending clipboard reads block duplicate clicks and keyboard pastes", async () => {
  const read = deferred();
  readClipboard.mockReturnValue(read.promise);
  const workspace = await mountWorkspace();
  const paste = button("Paste", workspace.container);
  await click(paste);
  await click(paste);
  await pasteFiles(paste, [imageFile("keyboard.png")]);
  expect(readClipboard).toHaveBeenCalledOnce();
  expect(workspace.onInputChange).not.toHaveBeenCalled();
  await act(async () => read.resolve([clipboardItem()]));
  await waitFor(() => expect(workspace.files).toHaveLength(1));
  expect(workspace.onInputChange).toHaveBeenCalledOnce();
});

test.each([{ disabled: true }, { running: true }])(
  "unavailable workspace prevents clipboard changes: %j",
  async (props) => {
    const workspace = await mountWorkspace(props);
    const paste = button("Paste", workspace.container);
    expect(paste).toBeTruthy();
    await click(paste);
    await pasteFiles(paste, [imageFile()]);
    expect(readClipboard).not.toHaveBeenCalled();
    expect(workspace.onInputChange).not.toHaveBeenCalled();
  },
);

test.each(["selection", "reset", "disabled", "running"])(
  "a pending Paste cannot overwrite a later %s change",
  async (change) => {
    const read = deferred();
    readClipboard.mockReturnValue(read.promise);
    const workspace = await mountWorkspace({ files: [imageFile()] });
    await click(button("Paste", workspace.container));
    const replacement = imageFile("replacement.png");
    if (change === "selection") await workspace.replaceFiles([replacement]);
    else if (change === "reset") await workspace.replaceFiles([]);
    else await workspace.update({ [change]: true });
    const expectedFiles = workspace.files;
    await act(async () => read.resolve([clipboardItem()]));
    expect(workspace.files).toEqual(expectedFiles);
    expect(workspace.onInputChange).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  },
);

test("keyboard Paste uses clipboard image files and applies the same file limits", async () => {
  const existing = imageFile();
  const pasted = imageFile("keyboard.png");
  const extra = imageFile("extra.png");
  const text = new File(["not an image"], "notes.txt", { type: "text/plain" });
  const workspace = await mountWorkspace({
    files: [existing],
    spec: { ...spec, input: { ...spec.input, maxFiles: 2 } },
  });
  const event = await pasteFiles(button("Paste", workspace.container), [text, pasted, extra]);
  expect(event.defaultPrevented).toBe(true);
  expect(workspace.files).toEqual([existing, pasted]);
  expect(workspace.container.textContent).toMatch(/Only 2 files/);
  expect(readClipboard).not.toHaveBeenCalled();
});

test("non-image file engines do not offer or intercept image Paste", async () => {
  const workspace = await mountWorkspace({
    spec: { ...spec, input: { ...spec.input, engine: "pdf", accept: "application/pdf" } },
  });
  expect(button("Paste", workspace.container)).toBeUndefined();
  const target = workspace.container.querySelector('input[type="file"]');
  const event = await pasteFiles(target, [imageFile()]);
  expect(event.defaultPrevented).toBe(false);
  expect(workspace.onInputChange).not.toHaveBeenCalled();
});
