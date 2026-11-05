import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React, { act } from "react";
import { createTranslator } from "next-intl";
import { getCommonMessages } from "../lib/i18n/messages.ts";
import { beforeEach, expect, test, vi } from "vitest";
import { FileProcessorWorkspace } from "../components/FileProcessorWorkspace.tsx";
const jpgSpec = await toolSpec("pdf-to-jpg");
const pngSpec = await toolSpec("pdf-to-png");
import { button, click, fill, mountTool, setupReactTools, waitFor } from "./helpers/react-tools.mjs";

vi.mock("../lib/tool-framework/hooks.ts", () => ({ loadToolHooks: async () => ({}) }));
vi.mock("../lib/tool-framework/artifacts.ts", async (original) => ({
  ...(await original()),
  cleanupArtifactJobWithRetry: async () => {},
}));
vi.mock("../components/GeneratedPdfPreview.tsx", () => ({ GeneratedPdfPreview: () => null }));

setupReactTools();

let workers;
let constructionFailure;
let objectUrlId;

beforeEach(() => {
  workers = [];
  constructionFailure = null;
  objectUrlId = 0;
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return `blob:pdf-source-${++objectUrlId}`;
      }
      static revokeObjectURL() {}
    },
  );
  // jsdom cannot measure a PDF viewport. Keep the real lazy-preview renderer
  // and provide its layout and visibility boundaries instead.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 480, 600));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target) {
        this.callback([{ target, isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "Worker",
    class {
      messages = [];
      constructor() {
        if (constructionFailure) {
          const failure = constructionFailure;
          constructionFailure = null;
          throw failure;
        }
        workers.push(this);
      }
      postMessage(message) {
        this.messages.push(message);
      }
      terminate() {}
      emit(data) {
        this.onmessage?.({ data });
      }
    },
  );
});

function source(name = "source.pdf") {
  return new File([`%PDF-${name}`], name, { type: "application/pdf", lastModified: 1 });
}

async function mountWorkspace(spec = jpgSpec, overrides = {}, i18n = {}) {
  const onInputChange = vi.fn();
  const onValidationChange = vi.fn();
  const onRun = vi.fn();
  let props = {
    spec,
    input: { text: "", files: [source()] },
    settings: { pages: "all", dpi: "150", quality: 80, background: "white" },
    result: null,
    lifecycle: "ready",
    onInputChange,
    onSettingChange: () => {},
    onValidationChange,
    primaryAction: { label: spec.trigger.actionLabel, disabled: false, onRun },
    ...overrides,
  };
  const element = () => React.createElement(FileProcessorWorkspace, props);
  const view = await mountTool(element(), { spec, ...i18n });
  return {
    ...view,
    onInputChange,
    onValidationChange,
    async update(next) {
      props = { ...props, ...next };
      await view.rerender(element());
    },
  };
}

function requests(type) {
  return workers.flatMap((worker) => worker.messages.filter((message) => message.type === type));
}

function currentInspection() {
  const worker = workers.at(-1);
  const message = worker.messages.filter((entry) => entry.type === "inspect").at(-1);
  return { worker, jobId: message.jobId, message };
}

async function completeInspection(inspection = currentInspection(), pageCount = 2) {
  const { worker, jobId } = inspection;
  const previews = Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    pageWidth: 400,
    pageHeight: 600,
  }));
  await act(async () => worker.emit({ type: "inspected", jobId, pageCount, previews }));
  await waitFor(() => {
    expect(worker.messages.some((message) => message.type === "inspect-thumbnails" && message.jobId === jobId)).toBe(
      true,
    );
  });
  await act(async () =>
    worker.emit({
      type: "thumbnails",
      jobId,
      previews: previews.map((page) => ({
        ...page,
        width: 512,
        height: 768,
        renderWidth: 512,
        mime: "image/jpeg",
        buffer: new Uint8Array([255, 216, 255, page.pageNumber]).buffer,
      })),
    }),
  );
}

function sourceImages(view) {
  return [...view.container.querySelectorAll("img")].filter((image) => /^Source PDF page \d+$/.test(image.alt));
}

test.each([jpgSpec, pngSpec])("$name opens selected source pages automatically and offers navigation", async (spec) => {
  const view = await mountWorkspace(spec);
  expect(requests("inspect")).toHaveLength(1);
  expect(currentInspection().message.key).toBe(spec.toolId.split(".")[1]);
  expect(view.container.textContent).toContain("Opening PDF");
  await completeInspection();
  expect(sourceImages(view).map((image) => image.alt)).toEqual(["Source PDF page 1", "Source PDF page 2"]);
  expect(sourceImages(view).every((image) => image.src.startsWith("blob:pdf-source-"))).toBe(true);
  const currentPage = view.container.querySelector('input[aria-label="Current page"]');
  expect(currentPage).toBeTruthy();
  await fill(currentPage, "2");
  await act(async () => currentPage.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(currentPage.value).toBe("2");
  expect(button("Zoom in", view.container)).toBeTruthy();
  expect(button("Expand preview", view.container)).toBeTruthy();
  expect(button("Remove source.pdf", view.container)).toBeTruthy();
});

test("source preview stays rendered through conversion and remains usable after completion", async () => {
  const view = await mountWorkspace();
  await completeInspection();
  const urls = sourceImages(view).map((image) => image.src);
  await view.update({ running: true, disabled: true, lifecycle: "running" });
  expect(sourceImages(view).map((image) => image.src)).toEqual(urls);
  expect(requests("inspect")).toHaveLength(1);
  expect(requests("inspect-close")).toHaveLength(0);
  const blob = new Blob(["jpg output"], { type: "image/jpeg" });
  const output = {
    storage: "blob",
    id: "page-1",
    jobId: "converted-output",
    name: "page-1.jpg",
    mime: "image/jpeg",
    size: blob.size,
    createdAt: 0,
    blob,
  };
  await view.update({
    running: false,
    disabled: false,
    lifecycle: "completed",
    result: { render: "files", files: [output] },
  });
  expect(sourceImages(view).map((image) => image.src)).toEqual(urls);
  expect(requests("inspect")).toHaveLength(1);
  expect(requests("inspect-close")).toHaveLength(0);
  expect(button("Download page-1.jpg", view.container)).toBeTruthy();
});

test("replacement hides old pages and ignores late preview messages from the previous file", async () => {
  const view = await mountWorkspace();
  const previous = currentInspection();
  await completeInspection(previous);
  const oldUrls = sourceImages(view).map((image) => image.src);
  await view.update({ input: { text: "", files: [source("replacement.pdf")] } });
  expect(sourceImages(view)).toHaveLength(0);
  expect(button("Remove replacement.pdf", view.container)).toBeTruthy();
  const replacement = currentInspection();
  expect(replacement.jobId).not.toBe(previous.jobId);
  await act(async () =>
    previous.worker.emit({
      type: "inspected",
      jobId: previous.jobId,
      pageCount: 9,
      previews: [{ pageNumber: 9, pageWidth: 400, pageHeight: 600 }],
    }),
  );
  expect(sourceImages(view)).toHaveLength(0);
  await completeInspection(replacement, 1);
  expect(sourceImages(view)).toHaveLength(1);
  expect(oldUrls).not.toContain(sourceImages(view)[0].src);
  expect(view.container.querySelector('input[aria-label="Current page"]').value).toBe("1");
});

test("removing a source closes its inspection and returns to intake without stale pages", async () => {
  const view = await mountWorkspace();
  const previous = currentInspection();
  await completeInspection(previous);
  await click(button("Remove source.pdf", view.container));
  expect(view.onInputChange).toHaveBeenCalledWith({ text: "", files: [] });
  await view.update({ input: view.onInputChange.mock.lastCall[0] });
  expect(sourceImages(view)).toHaveLength(0);
  expect(requests("inspect-close")).toEqual([expect.objectContaining({ jobId: previous.jobId })]);
  expect(view.container.textContent).toContain(jpgSpec.input.label);
  expect(button("Retry preview", view.container)).toBeUndefined();
});

test("inspection errors explain recovery and retry opens the selected file without blocking conversion", async () => {
  const view = await mountWorkspace();
  const { worker, jobId } = currentInspection();
  await act(async () =>
    worker.emit({ type: "failure", jobId, code: "invalid-pdf", message: "The PDF could not be opened." }),
  );
  expect(view.container.textContent).toContain("The PDF could not be opened.");
  expect(sourceImages(view)).toHaveLength(0);
  expect(view.onValidationChange).toHaveBeenLastCalledWith(null);
  await click(button("Retry preview", view.container));
  expect(requests("inspect")).toHaveLength(2);
  await completeInspection();
  expect(sourceImages(view)).toHaveLength(2);
  expect(view.container.textContent).not.toContain("The PDF could not be opened.");
  expect(button("Retry preview", view.container)).toBeUndefined();
});

test("synchronous preview startup failure can be retried without reselecting the PDF", async () => {
  constructionFailure = new Error("Preview worker unavailable.");
  const view = await mountWorkspace();
  expect(view.container.textContent).toContain("Preview worker unavailable.");
  expect(sourceImages(view)).toHaveLength(0);
  await click(button("Retry preview", view.container));
  expect(requests("inspect")).toHaveLength(1);
  await completeInspection();
  expect(sourceImages(view)).toHaveLength(2);
  expect(view.onInputChange).not.toHaveBeenCalled();
});

test("localized PDF navigation keeps canonical page numbers and source files intact", async () => {
  const view = await mountWorkspace(jpgSpec, {}, { locale: "hi" });
  await completeInspection();
  const currentPage = view.container.querySelector('input[aria-label="वर्तमान पेज"]');
  expect(currentPage).toBeTruthy();
  expect(view.container.textContent).toContain("2 में से पेज 1");
  expect([...view.container.querySelectorAll("img")].some((image) => image.alt === "मूल PDF का पेज 1")).toBe(true);
  await fill(currentPage, "2");
  await act(async () => currentPage.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(currentPage.value).toBe("2");
  expect(view.container.textContent).toContain("2 में से पेज 2");
  expect(currentInspection().message.files[0].name).toBe("source.pdf");
  expect(view.onInputChange).not.toHaveBeenCalled();
});

test("source preview renders database-provided Hindi inspection errors without losing retry", async () => {
  const view = await mountWorkspace(
    jpgSpec,
    {},
    {
      locale: "hi",
      messages: {
        "runtime.media.pdf.encryptedPdf": "पासवर्ड वाले PDF समर्थित नहीं हैं।",
      },
    },
  );
  const { worker, message } = currentInspection();
  await act(async () =>
    worker.emit({
      type: "failure",
      jobId: message.jobId,
      code: "encrypted-pdf",
      message: "Encrypted or password-protected PDFs are not supported.",
      details: { messageRef: { key: "media.pdf.encryptedPdf" } },
    }),
  );
  await waitFor(() => expect(view.container.textContent).toContain("पासवर्ड वाले PDF समर्थित नहीं हैं।"));
  expect(view.container.textContent).not.toContain("Encrypted or password-protected");
  const t = createTranslator({ locale: "hi", messages: getCommonMessages("hi"), namespace: "Workbench" });
  await click(button(t("mediaRetryPreview"), view.container));
  expect(requests("inspect")).toHaveLength(2);
});
