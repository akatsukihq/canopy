/**
 * The message protocol between the main thread and the single tool worker.
 *
 * This generalises the media protocol (`app/media/_lib/workerProtocol.ts`):
 * a request carries the tool's folder key instead of a media operation, and a
 * success carries a `ToolResult` instead of media output files.
 *
 * The file types and the input factory are declared here rather than imported
 * from the media protocol. They are small, and the framework must not depend on
 * `app/media/`, which this migration deletes — a package that outlives its own
 * dependency has to own the contract.
 *
 * `beginWorkerJob`, `reduceWorkerJobState` and `cancelWorkerJob` keep the
 * semantics they have in the media protocol: only the job that is currently
 * running can advance, and a stale message for another job is ignored.
 */

// Extension-qualified so this module loads under plain `node --test`, which is
// how its job-state reducer is covered. The type-only imports below are erased.
import { sanitizeFileName } from "./media/validation.ts";
import { parseToolErrorDetails, parseToolMessage, type ToolErrorDetails } from "./run.ts";
import {
  PDF_PREVIEW_CACHE_PIXELS,
  PDF_PREVIEW_MAX_PIXELS,
  PDF_PREVIEW_MAX_WIDTH,
  PDF_THUMBNAIL_CACHE_SIZE,
} from "./limits.ts";
import type { ToolResult } from "./result";
import type { ToolSpec } from "./spec";
import type { ToolPagePreview, ToolRunFile, ToolRunItem, ToolRunProgress } from "./run";

/** The 3x3 placement grid used by watermarks and page numbering. */
export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/**
 * Builds the structured-clone input. The original `File` remains the byte
 * source; only its untrusted metadata is normalised at the boundary.
 */
export function createToolRunFile(id: string, source: File): ToolRunFile {
  if (!id.trim()) throw new TypeError("Worker input ID is required.");
  if (!(source instanceof File)) {
    throw new TypeError("Worker input source must be a File.");
  }
  const normalizedMime = (source.type || "application/octet-stream").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalizedMime)) {
    throw new TypeError("Worker input MIME type is invalid.");
  }
  return {
    id: id.trim(),
    name: sanitizeFileName(source.name),
    mime: normalizedMime,
    size: source.size,
    source,
  };
}

/** The folder key is validated in the worker before it reaches a module path. */
export type ToolWorkerRequest = {
  readonly type: "run";
  readonly jobId: string;
  readonly key: string;
  /** The stored definition the page was rendered with; required to run. */
  readonly spec?: ToolSpec;
  readonly text?: string;
  readonly secondary?: string;
  readonly files: readonly ToolRunFile[];
  readonly items?: readonly ToolRunItem[];
  readonly settings: Readonly<Record<string, unknown>>;
};

/**
 * Opens a persistent page-inspection session for a single File-backed PDF.
 * The first response contains geometry only; thumbnails are requested later as
 * their cards enter (or approach) the viewport.
 */
export type ToolWorkerInspect = {
  readonly type: "inspect";
  readonly jobId: string;
  readonly key: string;
  /** Required unless `source` is "output". */
  readonly spec?: ToolSpec;
  readonly source?: "output";
  readonly files: readonly ToolRunFile[];
  readonly thumbnailWidth: number;
};

export type ToolWorkerThumbnailRequest = {
  readonly type: "inspect-thumbnails";
  readonly jobId: string;
  readonly pageNumbers: readonly number[];
  readonly renderWidth?: number;
};

export type ToolWorkerInspectionClose = {
  readonly type: "inspect-close";
  readonly jobId: string;
};

export type ToolWorkerCancel = {
  readonly type: "cancel";
  readonly jobId: string;
};

export type ToolWorkerMessage =
  ToolWorkerRequest | ToolWorkerInspect | ToolWorkerThumbnailRequest | ToolWorkerInspectionClose | ToolWorkerCancel;

export type ToolWorkerProgress = ToolRunProgress & {
  readonly type: "progress";
  readonly jobId: string;
};

export type ToolWorkerSuccess = {
  readonly type: "success";
  readonly jobId: string;
  readonly result: ToolResult;
};

export type ToolWorkerFailure = {
  readonly type: "failure";
  readonly jobId: string;
  readonly code: string;
  readonly message: string;
  readonly recovery?: string;
  readonly details?: ToolErrorDetails;
};

/**
 * The answer to an `inspect`. `previews` may carry more per page than
 * `ToolPagePreview` declares — the worker forwards what the renderer produced
 * rather than copying it into a narrower shape — so read only declared fields.
 */
export type ToolWorkerInspected = {
  readonly type: "inspected";
  readonly jobId: string;
  readonly pageCount: number;
  readonly previews: readonly ToolPagePreview[];
};

export type ToolPageThumbnail = ToolPagePreview & {
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer;
  readonly mime: "image/jpeg" | "image/png";
  readonly renderWidth?: number;
};

export type ToolWorkerThumbnails = {
  readonly type: "thumbnails";
  readonly jobId: string;
  readonly previews: readonly ToolPageThumbnail[];
};

export type ToolWorkerInspectionClosed = {
  readonly type: "inspection-closed";
  readonly jobId: string;
};

export type ToolWorkerCanceled = {
  readonly type: "canceled";
  readonly jobId: string;
};

export type ToolWorkerResponse =
  | ToolWorkerProgress
  | ToolWorkerSuccess
  | ToolWorkerInspected
  | ToolWorkerThumbnails
  | ToolWorkerInspectionClosed
  | ToolWorkerFailure
  | ToolWorkerCanceled;

export type ToolJobStatus = "idle" | "running" | "completed" | "failed" | "canceled";

export type ToolJobError = {
  readonly code: string;
  readonly message: string;
  readonly recovery?: string;
  readonly details?: ToolErrorDetails;
};

export type ToolJobState = {
  readonly status: ToolJobStatus;
  readonly jobId: string | null;
  readonly progress: ToolRunProgress | null;
  readonly result: ToolResult | null;
  readonly previews: readonly ToolPagePreview[];
  readonly pageCount: number;
  readonly error: ToolJobError | null;
};

export function createToolJobState(): ToolJobState {
  return {
    status: "idle",
    jobId: null,
    progress: null,
    result: null,
    previews: [],
    pageCount: 0,
    error: null,
  };
}

/** What a caller supplies; the job id is minted by the host that starts it. */
export type ToolRunRequestInput = {
  readonly key: string;
  readonly spec?: ToolSpec;
  readonly text?: string;
  readonly secondary?: string;
  readonly files?: readonly ToolRunFile[];
  readonly items?: readonly ToolRunItem[];
  readonly settings: Readonly<Record<string, unknown>>;
};

export function createToolWorkerRequest(input: ToolRunRequestInput & { readonly jobId: string }): ToolWorkerRequest {
  if (!input.jobId.trim()) throw new TypeError("Worker job ID is required.");
  if (!input.key.trim()) throw new TypeError("Worker tool key is required.");
  return {
    type: "run",
    jobId: input.jobId.trim(),
    key: input.key.trim(),
    ...(input.spec === undefined ? {} : { spec: input.spec }),
    text: input.text,
    secondary: input.secondary,
    files: input.files ?? [],
    items: input.items,
    settings: input.settings,
  };
}

/** What the page-picker surfaces render at; matches the legacy media width. */
export const INSPECT_THUMBNAIL_WIDTH = 180;

export type ToolInspectRequestInput = {
  readonly key: string;
  readonly spec?: ToolSpec;
  readonly file: ToolRunFile;
  readonly source?: "output";
  readonly thumbnailWidth?: number;
};

export function createToolInspectRequest(
  input: ToolInspectRequestInput & { readonly jobId: string },
): ToolWorkerInspect {
  if (!input.jobId.trim()) throw new TypeError("Worker job ID is required.");
  if (!input.key.trim()) throw new TypeError("Worker tool key is required.");
  const thumbnailWidth = input.thumbnailWidth ?? INSPECT_THUMBNAIL_WIDTH;
  if (!Number.isInteger(thumbnailWidth) || thumbnailWidth < 1) {
    throw new RangeError("Thumbnail width must be a positive integer.");
  }
  return {
    type: "inspect",
    jobId: input.jobId.trim(),
    key: input.key.trim(),
    ...(input.spec === undefined ? {} : { spec: input.spec }),
    ...(input.source === undefined ? {} : { source: input.source }),
    files: [input.file],
    thumbnailWidth,
  };
}

export type ToolThumbnailRequestInput = {
  readonly jobId: string;
  readonly pageNumbers: readonly number[];
  readonly renderWidth?: number;
};

export function createToolThumbnailRequest(input: ToolThumbnailRequestInput): ToolWorkerThumbnailRequest {
  const jobId = input.jobId.trim();
  if (!jobId) throw new TypeError("Worker job ID is required.");
  if (input.renderWidth !== undefined && !isPreviewWidth(input.renderWidth)) {
    throw new RangeError(`Preview width must be an integer from 1 to ${PDF_PREVIEW_MAX_WIDTH}.`);
  }
  if (input.pageNumbers.some((pageNumber) => !Number.isInteger(pageNumber) || pageNumber < 1)) {
    throw new RangeError("Thumbnail page numbers must be positive integers.");
  }
  const pageNumbers = [...new Set(input.pageNumbers)];
  if (pageNumbers.length === 0) {
    throw new RangeError("Choose at least one thumbnail page.");
  }
  if (pageNumbers.length > PDF_THUMBNAIL_CACHE_SIZE) {
    throw new RangeError(`At most ${PDF_THUMBNAIL_CACHE_SIZE} thumbnail pages may be requested at once.`);
  }
  return {
    type: "inspect-thumbnails",
    jobId,
    pageNumbers,
    ...(input.renderWidth === undefined ? {} : { renderWidth: input.renderWidth }),
  };
}

export function createToolInspectionCloseRequest(jobId: string): ToolWorkerInspectionClose {
  const normalized = jobId.trim();
  if (!normalized) throw new TypeError("Worker job ID is required.");
  return { type: "inspect-close", jobId: normalized };
}

/**
 * Structured-clone payloads are untrusted on both sides of the boundary, so
 * both directions are shape-checked before anything reads a field.
 */
export function isToolWorkerMessage(value: unknown): value is ToolWorkerMessage {
  if (!isRecord(value) || !isNonEmptyString(value.jobId)) return false;
  if (value.type === "cancel") return true;
  if (value.type === "inspect-close") return true;
  if (value.type === "inspect-thumbnails") {
    return (
      (value.renderWidth === undefined || isPreviewWidth(value.renderWidth)) &&
      Array.isArray(value.pageNumbers) &&
      value.pageNumbers.length > 0 &&
      value.pageNumbers.length <= PDF_THUMBNAIL_CACHE_SIZE &&
      value.pageNumbers.every((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0) &&
      new Set(value.pageNumbers).size === value.pageNumbers.length
    );
  }
  if (value.type === "inspect") {
    return (
      isNonEmptyString(value.key) &&
      (value.spec === undefined || isRecord(value.spec)) &&
      (value.source === undefined || value.source === "output") &&
      Array.isArray(value.files) &&
      value.files.length === 1 &&
      value.files.every(isToolRunFile) &&
      Number.isInteger(value.thumbnailWidth) &&
      (value.thumbnailWidth as number) > 0
    );
  }
  return (
    value.type === "run" &&
    isNonEmptyString(value.key) &&
    (value.spec === undefined || isRecord(value.spec)) &&
    isOptionalString(value.text) &&
    isOptionalString(value.secondary) &&
    Array.isArray(value.files) &&
    value.files.every(isToolRunFile) &&
    (value.items === undefined || (Array.isArray(value.items) && value.items.every(isRunItem))) &&
    isRecord(value.settings)
  );
}

export function isToolWorkerResponse(value: unknown): value is ToolWorkerResponse {
  if (!isRecord(value) || !isNonEmptyString(value.jobId)) return false;
  if (value.type === "canceled") return true;
  if (value.type === "inspection-closed") return true;
  if (value.type === "progress") {
    return (
      typeof value.completed === "number" &&
      typeof value.total === "number" &&
      typeof value.stage === "string" &&
      (value.stageMessage === undefined || parseToolMessage(value.stageMessage) !== undefined)
    );
  }
  if (value.type === "failure") {
    return (
      typeof value.code === "string" &&
      typeof value.message === "string" &&
      isOptionalString(value.recovery) &&
      (value.details === undefined || parseToolErrorDetails(value.details) !== undefined)
    );
  }
  if (value.type === "inspected") {
    return typeof value.pageCount === "number" && Array.isArray(value.previews) && value.previews.every(isPagePreview);
  }
  if (value.type === "thumbnails") {
    return (
      Array.isArray(value.previews) &&
      value.previews.length <= PDF_THUMBNAIL_CACHE_SIZE &&
      value.previews.every(isPageThumbnail)
    );
  }
  // The result is produced by this repo's own worker, so only the envelope is
  // checked here; the render union is the renderer's own exhaustive switch.
  return value.type === "success" && isRecord(value.result) && typeof value.result.render === "string";
}

export function beginWorkerJob(state: ToolJobState, jobId: string): ToolJobState {
  if (!jobId.trim()) throw new TypeError("Worker job ID is required.");
  return {
    ...state,
    status: "running",
    jobId: jobId.trim(),
    progress: null,
    result: null,
    previews: [],
    pageCount: 0,
    error: null,
  };
}

export function reduceWorkerJobState(state: ToolJobState, message: ToolWorkerResponse): ToolJobState {
  if (message.jobId !== state.jobId) return state;
  if (message.type === "thumbnails") {
    if (state.status !== "completed" || state.pageCount < 1) return state;
    return { ...state, previews: mergePageThumbnails(state.previews, message.previews) };
  }
  if (message.type === "inspection-closed") return state;
  // Inspection completes geometry first; its live session can still fail
  // while rendering requested pages. Conversion results remain terminal.
  const inspectionFailure =
    message.type === "failure" && state.status === "completed" && state.pageCount > 0 && state.result === null;
  if (state.status !== "running" && !inspectionFailure) return state;
  if (message.type === "progress") {
    const { completed, total, stage, stageMessage } = message;
    return { ...state, progress: { completed, total, stage, ...(stageMessage ? { stageMessage } : {}) } };
  }
  if (message.type === "failure") {
    return {
      ...state,
      status: "failed",
      progress: null,
      error: {
        code: message.code,
        message: message.message,
        recovery: message.recovery,
        ...(message.details ? { details: parseToolErrorDetails(message.details) } : {}),
      },
    };
  }
  if (message.type === "canceled") {
    return { ...state, status: "canceled", progress: null };
  }
  if (message.type === "inspected") {
    return {
      ...state,
      status: "completed",
      progress: null,
      previews: message.previews,
      pageCount: message.pageCount,
    };
  }
  return {
    ...state,
    status: "completed",
    progress: null,
    result: message.result,
  };
}

function pageGeometry(preview: ToolPagePreview): ToolPagePreview {
  return {
    pageNumber: preview.pageNumber,
    pageWidth: preview.pageWidth,
    pageHeight: preview.pageHeight,
  };
}

/** Keeps geometry for every page while bounding retained thumbnail buffers. */
function mergePageThumbnails(
  pages: readonly ToolPagePreview[],
  incoming: readonly ToolPageThumbnail[],
): readonly ToolPagePreview[] {
  const incomingByPage = new Map(incoming.map((preview) => [preview.pageNumber, preview] as const));
  const bufferedOrder = pages
    .filter((preview) => readOwn(preview, "buffer") instanceof ArrayBuffer)
    .map((preview) => preview.pageNumber)
    .filter((pageNumber) => !incomingByPage.has(pageNumber));
  bufferedOrder.push(...incoming.map((preview) => preview.pageNumber));
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
  const retained = new Set<number>();
  let pixels = 0;
  for (const pageNumber of bufferedOrder.slice(-PDF_THUMBNAIL_CACHE_SIZE).reverse()) {
    const page = incomingByPage.get(pageNumber) ?? byPage.get(pageNumber);
    const size = Number(readOwn(page, "width")) * Number(readOwn(page, "height"));
    if (pixels + size > PDF_PREVIEW_CACHE_PIXELS) break;
    pixels += size;
    retained.add(pageNumber);
  }

  return pages.map((preview) => {
    const next = incomingByPage.get(preview.pageNumber) ?? preview;
    return retained.has(preview.pageNumber) ? next : pageGeometry(preview);
  });
}

export function cancelWorkerJob(state: ToolJobState): { state: ToolJobState; message: ToolWorkerCancel } | null {
  if (state.status !== "running" || !state.jobId) return null;
  return {
    state: { ...state, status: "canceled", progress: null },
    message: { type: "cancel", jobId: state.jobId },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isToolRunFile(value: unknown): value is ToolRunFile {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return false;
  if (!(value.source instanceof File)) return false;
  return (
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.mime) &&
    typeof value.size === "number" &&
    value.size === value.source.size
  );
}

function isPagePreview(value: unknown): value is ToolPagePreview {
  return (
    isRecord(value) &&
    typeof value.pageNumber === "number" &&
    typeof value.pageWidth === "number" &&
    typeof value.pageHeight === "number"
  );
}

function isPageThumbnail(value: unknown): value is ToolPageThumbnail {
  const width = readOwn(value, "width");
  const height = readOwn(value, "height");
  return (
    isPagePreview(value) &&
    readOwn(value, "buffer") instanceof ArrayBuffer &&
    (readOwn(value, "mime") === "image/jpeg" || readOwn(value, "mime") === "image/png") &&
    (readOwn(value, "renderWidth") === undefined || isPreviewWidth(readOwn(value, "renderWidth"))) &&
    typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isInteger(height) &&
    height > 0 &&
    width * height <= PDF_PREVIEW_MAX_PIXELS
  );
}

function isPreviewWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= PDF_PREVIEW_MAX_WIDTH;
}

function readOwn(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function isRunItem(value: unknown): value is ToolRunItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.selected === "boolean" &&
    (value.rotation === 0 || value.rotation === 90 || value.rotation === 180 || value.rotation === 270)
  );
}
