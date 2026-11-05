/**
 * PDF rasterisation. This module is the ONLY place in the codebase that may
 * import `pdfjs-dist`, and the only place that sets `GlobalWorkerOptions
 * .workerSrc`. It allocates `OffscreenCanvas`, so it is worker-only and must
 * never be reachable from a main-thread import graph.
 */

import { ToolError, type ToolRunFile, type ToolRunProgress } from "../run.ts";
import { getRuntimeLimits } from "../limits.ts";
import { clamp, context2d } from "./imageCodec.ts";
import {
  enforcePageLimit,
  isPasswordError,
  resolvePageNumbers,
  validatePdfInput,
  type PdfPageSelection,
} from "./pdfDocument.ts";
import { validatePdfSelection } from "./validation.ts";

/** 100 megapixels — the same ceiling `validation.ts` applies to raster images. */
const MAX_RENDERED_PIXELS = 100_000_000;

export type PdfColorMode = "original" | "grayscale" | "black-and-white";

export type RenderedPdfPage = {
  readonly canvas: OffscreenCanvas;
  readonly pageCount: number;
  readonly pageNumber: number;
  readonly pointHeight: number;
  readonly pointWidth: number;
};

export type RenderPdfRequest = {
  readonly file: ToolRunFile;
  readonly selection: PdfPageSelection;
  readonly dpi: number;
  readonly background: "white" | "transparent";
  readonly signal: AbortSignal;
  readonly color?: PdfColorMode;
  readonly progress?: (progress: ToolRunProgress) => void;
  /** Raster page ceilings are lower than structural ones; off for previews. */
  readonly rasterLimit?: boolean;
};

export type PdfPageThumbnail = {
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer;
  readonly mime: "image/jpeg" | "image/png";
  readonly renderWidth?: number;
};

export type PdfInspection = {
  readonly pageCount: number;
  readonly pages: readonly {
    readonly pageNumber: number;
    readonly pageWidth: number;
    readonly pageHeight: number;
  }[];
};

export type PdfInspectionSession = PdfInspection & {
  readonly renderThumbnails: (
    pageNumbers: readonly number[],
    renderWidth?: number,
  ) => Promise<readonly PdfPageThumbnail[]>;
  readonly close: () => Promise<void>;
};

type WorkerCanvas = {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
};

// PDF.js also needs scratch canvases for image scaling and transparency.
// Its default DOMCanvasFactory cannot create those inside a worker.
class WorkerCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: context2d(canvas) };
  }

  reset({ canvas }: WorkerCanvas, width: number, height: number) {
    if (!canvas) throw new Error("Canvas is not available.");
    canvas.width = width;
    canvas.height = height;
  }

  destroy(target: WorkerCanvas) {
    if (target.canvas) target.canvas.width = target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

async function openPdfDocument(file: ToolRunFile, signal: AbortSignal) {
  signal.throwIfAborted();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  const range = new pdfjs.PDFDataRangeTransport(file.size, null);
  let aborted = false;
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
  let rejectRangeRead: (reason: unknown) => void = () => undefined;
  const rangeReadFailure = new Promise<never>((_resolve, reject) => {
    rejectRangeRead = reject;
  });
  // The race below observes this rejection while the document is opening. The
  // extra observer also prevents a late Blob read failure from becoming an
  // unhandled rejection after PDF.js has already rejected for another reason.
  void rangeReadFailure.catch(() => undefined);

  const failRangeRead = (_cause: unknown) => {
    if (aborted || signal.aborted) return;
    aborted = true;
    const error = new ToolError(
      "file-read-failed",
      "The PDF could not be read from this device.",
      "Choose the file again and keep it available until processing finishes.",
      {
        messageRef: { key: "media.pdf.fileReadFailed" },
        recoveryMessage: { key: "media.recovery.pdf.fileReadFailed" },
      },
    );
    rejectRangeRead(error);
    range.abort();
    void loadingTask?.destroy();
  };
  range.requestDataRange = (begin, end) => {
    if (aborted || signal.aborted) return;
    let read: Promise<ArrayBuffer>;
    try {
      read = file.source.slice(begin, end).arrayBuffer();
    } catch (error) {
      failRangeRead(error);
      return;
    }
    void read.then((buffer) => {
      if (!aborted && !signal.aborted) {
        range.onDataRange(begin, new Uint8Array(buffer));
      }
    }, failRangeRead);
  };
  range.abort = () => {
    aborted = true;
  };
  const workerFonts = (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
  const documentOptions = {
    CanvasFactory: WorkerCanvasFactory,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    length: file.size,
    maxImageSize: MAX_RENDERED_PIXELS,
    // OffscreenCanvas uses the worker's font set, not document.fonts.
    ownerDocument: workerFonts ? { fonts: workerFonts } : undefined,
    range,
    stopAtErrors: true,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0];
  loadingTask = pdfjs.getDocument(documentOptions);
  const abort = () => {
    range.abort();
    void loadingTask.destroy();
  };
  let closed = false;
  signal.addEventListener("abort", abort, { once: true });
  try {
    return {
      document: await Promise.race([loadingTask.promise, rangeReadFailure]),
      read<T>(operation: Promise<T>) {
        return Promise.race([operation, rangeReadFailure]);
      },
      async close() {
        if (closed) return;
        closed = true;
        signal.removeEventListener("abort", abort);
        range.abort();
        await loadingTask.destroy().catch(() => undefined);
      },
    };
  } catch (error) {
    signal.removeEventListener("abort", abort);
    range.abort();
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}

export async function forEachRenderedPdfPage(
  request: RenderPdfRequest,
  onPage: (page: RenderedPdfPage, index: number, total: number) => Promise<void>,
): Promise<{ pageCount: number }> {
  const { file, selection, dpi, background, signal, color = "original", progress, rasterLimit = true } = request;
  const renderScheduler = {
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  };
  let opened: Awaited<ReturnType<typeof openPdfDocument>> | null = null;
  try {
    opened = await openPdfDocument(file, signal);
    const { document } = opened;
    const pages = resolvePageNumbers(selection, document.numPages);
    enforcePageLimit(file, pages.length, rasterLimit);
    for (let index = 0; index < pages.length; index += 1) {
      signal.throwIfAborted();
      const pageNumber = pages[index];
      const page = await opened.read(document.getPage(pageNumber));
      const pointViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: dpi / 72 });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      if (width * height > MAX_RENDERED_PIXELS) {
        throw new ToolError("too-many-pixels", "A rendered PDF page exceeds 100 megapixels.", undefined, {
          messageRef: { key: "media.pdf.tooManyPixels" },
        });
      }
      const canvas = new OffscreenCanvas(width, height);
      const context = context2d(canvas);
      if (background === "white") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      progress?.({
        completed: index,
        total: pages.length,
        stage: "Rendering PDF page",
        stageMessage: { key: "media.progress.renderingPdfPage" },
      });
      Object.assign(globalThis, { window: renderScheduler });
      try {
        await opened.read(
          page.render({
            background: background === "white" ? "#ffffff" : "rgba(0,0,0,0)",
            canvas: null,
            canvasContext: context as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise,
        );
      } finally {
        Reflect.deleteProperty(globalThis, "window");
      }
      if (color !== "original") applyColorMode(context, width, height, color);
      try {
        await onPage(
          {
            canvas,
            pageCount: document.numPages,
            pageNumber,
            pointHeight: pointViewport.height,
            pointWidth: pointViewport.width,
          },
          index,
          pages.length,
        );
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
    return { pageCount: document.numPages };
  } catch (error) {
    if (isPasswordError(error)) {
      throw new ToolError("encrypted-pdf", "Encrypted or password-protected PDFs are not supported.", undefined, {
        messageRef: { key: "media.pdf.encryptedPdf" },
      });
    }
    throw error;
  } finally {
    if (opened) {
      try {
        await opened.close();
      } catch {
        // The document may already be torn down after a parse failure.
      }
    }
  }
}

/**
 * Opens one range-backed inspection document and returns geometry for every
 * page. Raster work is deliberately deferred until `renderThumbnails` asks for
 * pages that are visible or close to the viewport.
 */
export async function openPdfInspectionSession(
  file: ToolRunFile,
  thumbnailWidth: number,
  signal: AbortSignal,
): Promise<PdfInspectionSession> {
  await validatePdfInput(file);
  const selection = validatePdfSelection([{ size: file.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  let opened: Awaited<ReturnType<typeof openPdfDocument>>;
  try {
    opened = await openPdfDocument(file, signal);
  } catch (error) {
    if (isPasswordError(error)) {
      throw new ToolError("encrypted-pdf", "Encrypted or password-protected PDFs are not supported.", undefined, {
        messageRef: { key: "media.pdf.encryptedPdf" },
      });
    }
    throw error;
  }
  const pages: PdfInspection["pages"][number][] = [];
  const scheduler = {
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  };
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  const renderRequested = async (
    pageNumbers: readonly number[],
    renderWidth?: number,
  ): Promise<readonly PdfPageThumbnail[]> => {
    if (closed) throw new DOMException("The inspection is closed.", "AbortError");
    signal.throwIfAborted();
    if (
      renderWidth !== undefined &&
      (!Number.isInteger(renderWidth) || renderWidth < 1 || renderWidth > getRuntimeLimits().pdfPreviewMaxWidth)
    ) {
      throw new ToolError("invalid-preview-size", "The requested PDF preview size is invalid.", undefined, {
        messageRef: { key: "media.pdf.invalidPreviewSize" },
      });
    }
    const unique = [...new Set(pageNumbers)];
    if (
      unique.some(
        (pageNumber) => !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > opened.document.numPages,
      )
    ) {
      throw new ToolError("invalid-page-selection", "A requested PDF preview page does not exist.", undefined, {
        messageRef: { key: "media.pdf.invalidPageSelection" },
      });
    }
    const thumbnails: PdfPageThumbnail[] = [];
    for (const pageNumber of unique) {
      signal.throwIfAborted();
      if (closed) throw new DOMException("The inspection is closed.", "AbortError");
      const page = await opened.read(opened.document.getPage(pageNumber));
      const point = page.getViewport({ scale: 1 });
      const scale = Math.min(
        renderWidth === undefined ? Math.min(1, thumbnailWidth / point.width) : renderWidth / point.width,
        Math.sqrt(getRuntimeLimits().pdfPreviewMaxPixels / (point.width * point.height)),
      );
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = new OffscreenCanvas(width, height);
      try {
        const context = context2d(canvas);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        Object.assign(globalThis, { window: scheduler });
        try {
          await opened.read(
            page.render({
              background: "#ffffff",
              canvas: null,
              canvasContext: context as unknown as CanvasRenderingContext2D,
              viewport,
            }).promise,
          );
        } finally {
          Reflect.deleteProperty(globalThis, "window");
        }
        thumbnails.push({
          pageNumber,
          pageWidth: point.width,
          pageHeight: point.height,
          width,
          height,
          buffer: await encodeCanvas(canvas, renderWidth === undefined ? "jpg" : "png", 0.72),
          mime: renderWidth === undefined ? "image/jpeg" : "image/png",
          ...(renderWidth === undefined ? {} : { renderWidth }),
        });
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
    return thumbnails;
  };

  try {
    enforcePageLimit(file, opened.document.numPages, false);
    for (let pageNumber = 1; pageNumber <= opened.document.numPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page = await opened.read(opened.document.getPage(pageNumber));
      try {
        const point = page.getViewport({ scale: 1 });
        pages.push({
          pageNumber,
          pageWidth: point.width,
          pageHeight: point.height,
        });
      } finally {
        page.cleanup();
      }
    }
    return {
      pageCount: opened.document.numPages,
      pages,
      renderThumbnails(pageNumbers, renderWidth) {
        const result = queue.then(() => renderRequested(pageNumbers, renderWidth));
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
      async close() {
        if (closed) return;
        closed = true;
        await queue.catch(() => undefined);
        await opened.close();
      },
    };
  } catch (error) {
    await opened.close().catch(() => undefined);
    if (isPasswordError(error)) {
      throw new ToolError("encrypted-pdf", "Encrypted or password-protected PDFs are not supported.", undefined, {
        messageRef: { key: "media.pdf.encryptedPdf" },
      });
    }
    throw error;
  }
}

export async function encodeCanvas(
  canvas: OffscreenCanvas,
  extension: "jpg" | "png",
  quality: number,
): Promise<ArrayBuffer> {
  const image = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
  if (extension === "jpg") {
    const { encode } = await import("@jsquash/jpeg");
    return encode(image, { quality: Math.round(clamp(quality, 0.01, 1) * 100) });
  }
  const { encode } = await import("@jsquash/png");
  return encode(image);
}

export function applyColorMode(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  mode: "grayscale" | "black-and-white",
): void {
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = Math.round(
      image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722,
    );
    const value = mode === "black-and-white" ? (luminance >= 128 ? 255 : 0) : luminance;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}
