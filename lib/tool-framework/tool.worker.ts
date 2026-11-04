/**
 * The one worker for every tool that runs off the main thread.
 *
 * It knows nothing about any individual tool: the request carries a folder
 * key, and the two dynamic imports below are bundler context modules over
 * `tools/*` — the static prefix and suffix let the bundler emit one chunk per
 * folder and fetch only the requested one. There is no map and no registry.
 */

import { TOOL_SLUG_PATTERN } from "../tool-catalog/index.ts";

import { ArtifactStorageError, cleanupArtifactJobWithRetry, createArtifactWriter } from "./artifacts";
import { assertRunnableFiles } from "./fileGuard";
import { assertRunnableText } from "./inputGuard";
import { createThrottledProgressReporter } from "./progress";
import { ToolError, type ToolRun, type ToolRunProgress } from "./run";
import { parseSettings } from "./settings";
import type { ToolInputSpec, ToolSpec } from "./spec";
import {
  isToolWorkerMessage,
  type ToolWorkerInspectionClose,
  type ToolWorkerInspect,
  type ToolWorkerRequest,
  type ToolWorkerResponse,
  type ToolWorkerThumbnailRequest,
} from "./workerProtocol";
import type { PdfInspectionSession } from "./media/pdfRender";

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ToolWorkerResponse, transfer?: Transferable[]): void;
};

const scope = globalThis as unknown as WorkerScope;

let running: AbortController | null = null;
let openingInspection: { readonly jobId: string; readonly controller: AbortController } | null = null;
let inspection: {
  readonly jobId: string;
  readonly controller: AbortController;
  readonly session: PdfInspectionSession;
} | null = null;

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (!isToolWorkerMessage(message)) return;
  if (message.type === "cancel") {
    if (openingInspection?.jobId === message.jobId || inspection?.jobId === message.jobId) {
      void closeInspection(message.jobId).then(() => {
        scope.postMessage({ type: "canceled", jobId: message.jobId });
      });
    } else {
      running?.abort();
    }
    return;
  }
  if (message.type === "inspect-close") {
    void closeInspectionJob(message);
    return;
  }
  if (message.type === "inspect-thumbnails") {
    void thumbnailJob(message);
    return;
  }
  if (message.type === "inspect") {
    void inspectJob(message);
    return;
  }
  void runJob(message);
});

/** Starts a job, aborting whatever was running. Returns its abort controller. */
function beginJob(): AbortController {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  return controller;
}

async function runJob(message: ToolWorkerRequest): Promise<void> {
  const controller = beginJob();
  const jobId = message.jobId;
  const signal = controller.signal;
  const progress = createThrottledProgressReporter<ToolRunProgress>((value) => {
    if (signal.aborted) return;
    scope.postMessage({ type: "progress", jobId, ...value });
  });
  const artifactWriter = createArtifactWriter(jobId, {
    signal,
    onStorageWarning: (warning) => {
      progress({ completed: 0, total: 1, stage: warning.message });
    },
  });
  let succeeded = false;
  let failure: ToolWorkerResponse | null = null;
  try {
    await closeInspection();
    if (!TOOL_SLUG_PATTERN.test(message.key)) {
      throw new ToolError("unknown-tool", "This tool is not available.");
    }
    const spec = readSpec(message.spec, message.key);
    const runModule: unknown = await import(`../../tools/${message.key}/run.worker`).catch((error: unknown) => {
      // A server-only tool has no worker implementation. Only classify the
      // missing entry itself; a missing dependency is a genuine tool failure.
      const missingModule =
        error instanceof Error ? /cannot find module ['"]([^'"]+)['"]/i.exec(error.message)?.[1] : undefined;
      if (
        missingModule?.endsWith(`/${message.key}/run.worker`) ||
        missingModule?.endsWith(`/${message.key}/run.worker.ts`)
      ) {
        throw new ToolError("unknown-tool", "This tool is not available.");
      }
      throw error;
    });
    signal.throwIfAborted();
    await assertRunnableFiles(spec, message.files, signal);
    assertRunnableText(spec, { text: message.text, secondary: message.secondary });
    const result = await readRun(runModule)({
      input: {
        text: message.text ?? "",
        secondary: message.secondary,
        files: message.files,
        items: message.items,
      },
      settings: parseSettings(spec.settings, message.settings),
      signal,
      progress,
      writeArtifact: artifactWriter.write,
    });
    signal.throwIfAborted();
    succeeded = true;
    scope.postMessage({ type: "success", jobId, result });
  } catch (error) {
    failure = toFailureMessage(error, jobId);
  } finally {
    if (!succeeded) {
      await cleanupArtifactJobWithRetry(jobId).catch(() => undefined);
    }
    if (running === controller) running = null;
  }
  if (failure) scope.postMessage(failure);
}

/**
 * Renders page previews for a document. Input inspection follows the tool's
 * spec; generated PDF output is validated by the PDF renderer itself.
 *
 * `pdfRender` is imported dynamically and only here: it owns `pdfjs-dist`, so
 * keeping it behind this branch keeps the vendor chunk off every other job.
 */
async function inspectJob(message: ToolWorkerInspect): Promise<void> {
  running?.abort();
  await closeInspection();
  const controller = new AbortController();
  const jobId = message.jobId;
  const signal = controller.signal;
  openingInspection = { jobId, controller };
  let openedSession: PdfInspectionSession | null = null;
  try {
    if (!TOOL_SLUG_PATTERN.test(message.key)) {
      throw new ToolError("unknown-tool", "This tool is not available.");
    }
    signal.throwIfAborted();
    if (message.source !== "output") {
      const spec = readSpec(message.spec, message.key);
      if (spec.input.kind !== "files" || spec.input.inspect !== true || spec.input.engine !== "pdf") {
        throw new ToolError("inspection-unsupported", "This tool does not use page previews.");
      }
      // Input previews apply the same trust boundaries as the run path.
      await assertRunnableFiles(spec, message.files, signal);
      assertRunnableText(spec, { text: undefined, secondary: undefined });
    }
    const file = message.files[0];
    if (!file) throw new ToolError("no-files", "Choose at least one file.");
    const { openPdfInspectionSession } = await import("./media/pdfRender");
    const session = await openPdfInspectionSession(file, message.thumbnailWidth, signal);
    openedSession = session;
    signal.throwIfAborted();
    inspection = { jobId, controller, session };
    openedSession = null;
    scope.postMessage({
      type: "inspected",
      jobId,
      pageCount: session.pageCount,
      previews: session.pages,
    });
  } catch (error) {
    await openedSession?.close().catch(() => undefined);
    scope.postMessage(toFailureMessage(error, jobId));
  } finally {
    if (openingInspection?.controller === controller) openingInspection = null;
  }
}

async function thumbnailJob(message: ToolWorkerThumbnailRequest): Promise<void> {
  const current = inspection;
  if (!current || current.jobId !== message.jobId) return;
  try {
    const previews = await current.session.renderThumbnails(message.pageNumbers, message.renderWidth);
    if (inspection !== current || current.controller.signal.aborted) return;
    scope.postMessage(
      { type: "thumbnails", jobId: message.jobId, previews },
      previews.map((preview) => preview.buffer),
    );
  } catch (error) {
    if (inspection !== current) return;
    scope.postMessage(toFailureMessage(error, message.jobId));
  }
}

async function closeInspectionJob(message: ToolWorkerInspectionClose): Promise<void> {
  await closeInspection(message.jobId);
  scope.postMessage({ type: "inspection-closed", jobId: message.jobId });
}

async function closeInspection(jobId?: string): Promise<void> {
  if (openingInspection && (!jobId || openingInspection.jobId === jobId)) {
    openingInspection.controller.abort();
    openingInspection = null;
  }
  const current = inspection;
  if (!current || (jobId && current.jobId !== jobId)) return;
  inspection = null;
  current.controller.abort();
  await current.session.close().catch(() => undefined);
}

/** Never leaks a stack trace, a module path, or an internal message. */
function toFailureMessage(error: unknown, jobId: string): ToolWorkerResponse {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { type: "canceled", jobId };
  }
  if (error instanceof ToolError) {
    return {
      type: "failure",
      jobId,
      code: error.code,
      message: error.message,
      recovery: error.recovery,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  if (error instanceof ArtifactStorageError) {
    return {
      type: "failure",
      jobId,
      code: error.code,
      message: error.message,
      recovery:
        error.code === "output-too-large"
          ? "Reduce the output size or process fewer files at once."
          : "Free browser storage, keep this tab open, and run the tool again.",
    };
  }
  return {
    type: "failure",
    jobId,
    code: "processing-failed",
    message: "This tool could not finish. The input may be malformed or unsupported.",
  };
}

function readSpec(value: unknown, key: string): ToolSpec {
  const toolId = pick(value, "toolId");
  if (
    typeof toolId !== "string" ||
    toolId.split(".")[1] !== key ||
    pick(value, "input") === undefined ||
    pick(value, "settings") === undefined
  ) {
    throw new ToolError("unknown-tool", "This tool is not available.");
  }
  return value as ToolSpec;
}

function readRun(module: unknown): ToolRun<unknown> {
  const value = pick(module, "default") ?? pick(module, "run");
  if (typeof value !== "function") {
    throw new ToolError("unknown-tool", "This tool is not available.");
  }
  return value as ToolRun<unknown>;
}

function pick(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
