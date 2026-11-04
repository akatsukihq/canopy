/**
 * Moved from `preserveCompressPdf` (`app/media/_workers/pdf.worker.ts:460-489`)
 * and `strongCompressPdf` (`pdf.worker.ts:491-524`), plus the shared preflight
 * from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `PdfWorkerError` re-wrapped `PdfPreflightError` and `QpdfAdapterError` so the
 * worker protocol could carry the code. `ToolError` is now the only error type
 * the host understands, so the two adapters are translated here instead.
 *
 * `STRONG_PDF_COMPRESSION_PRESETS` is inlined rather than imported from
 * `app/media/_lib/tools.ts`: that module is scheduled for deletion, and the
 * table is this tool's own data.
 *
 * The `crossOriginIsolated` / `SharedArrayBuffer` requirement lives inside
 * `preservePdfWithQpdf`, which still checks it before loading anything, and
 * still loads `qpdf-wasm` lazily. Neither is duplicated or bypassed here.
 */

import { validatePdfInput } from "../../lib/tool-framework/media/pdfDocument.ts";
import { readToolFile } from "../../lib/tool-framework/media/fileBytes.ts";
import { encodeCanvas, forEachRenderedPdfPage, type PdfColorMode } from "../../lib/tool-framework/media/pdfRender.ts";
import { inspectPdfBeforeStructuralRewrite, PdfPreflightError } from "../../lib/tool-framework/media/pdfRules.ts";
import { preservePdfWithQpdf, QpdfAdapterError } from "../../lib/tool-framework/media/qpdf.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun, type ToolRunFile, type ToolRunProgress } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly mode: string;
  readonly removeMetadata: boolean;
  readonly strongPreset: string;
  readonly color: string;
  readonly confirmed: boolean;
};

const STRONG_MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** Copied verbatim from `STRONG_PDF_COMPRESSION_PRESETS` in `_lib/tools.ts`. */
const STRONG_PRESETS = {
  high: { dpi: 150, quality: 0.85 },
  balanced: { dpi: 120, quality: 0.75 },
  smallest: { dpi: 96, quality: 0.6 },
} as const;

type StrongPreset = keyof typeof STRONG_PRESETS;

function strongPreset(value: string): StrongPreset {
  return value === "high" || value === "smallest" ? value : "balanced";
}

function colorMode(value: string): PdfColorMode {
  return value === "grayscale" || value === "black-and-white" ? value : "original";
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to compress.", undefined, { messageRef: { key: "errors.noFiles" } });
  if (ctx.settings.mode === "strong" && input.size > STRONG_MAX_INPUT_BYTES) {
    throw new ToolError(
      "file-too-large",
      "Strong Compression supports PDFs up to 50 MiB.",
      "Choose Preserve Document for PDFs up to 100 MiB, or use a smaller file.",
      { messageRef: { key: "errors.fileTooLarge" }, recoveryMessage: { key: "recovery.fileTooLarge" } },
    );
  }
  const selection = validatePdfSelection([{ size: input.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const bytes =
    ctx.settings.mode === "strong"
      ? await strongCompress(ctx.settings, input, ctx.signal, ctx.progress)
      : await preserveCompress(ctx.settings, input, ctx.progress);
  const output = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", ctx.settings.mode === "strong" ? "strong-compressed" : "compressed"),
    mime: "application/pdf",
    source: bytes,
  });

  return {
    render: "files",
    files: [output],
    inputBytes: input.size,
    outputBytes: output.size,
  };
};

async function preserveCompress(
  settings: Settings,
  input: ToolRunFile,
  progress: (progress: ToolRunProgress) => void,
): Promise<Uint8Array> {
  try {
    const data = await readToolFile(input);
    progress({ completed: 0, total: 1, stage: "Inspecting PDF", stageMessage: { key: "progress.inspectingPdf" } });
    await inspectPdfBeforeStructuralRewrite(data);
    progress({ completed: 0, total: 1, stage: "Loading qpdf", stageMessage: { key: "progress.loadingQpdf" } });
    const buffer = await preservePdfWithQpdf(data, {
      // Only used to name a file inside qpdf's virtual filesystem, so any
      // unique token that survives its own sanitisation is correct here.
      jobId: crypto.randomUUID(),
      removeMetadata: settings.removeMetadata,
    });
    progress({
      completed: 1,
      total: 1,
      stage: "Compression complete",
      stageMessage: { key: "progress.compressionComplete" },
    });
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof PdfPreflightError || error instanceof QpdfAdapterError) {
      throw new ToolError(error.code, error.message, undefined, error.details);
    }
    throw error;
  }
}

async function strongCompress(
  settings: Settings,
  input: ToolRunFile,
  signal: AbortSignal,
  progress: (progress: ToolRunProgress) => void,
): Promise<Uint8Array> {
  if (settings.confirmed !== true) {
    throw new ToolError("confirmation-required", "Confirm Strong Compression before processing.", undefined, {
      messageRef: { key: "errors.confirmationRequired" },
    });
  }
  const { PDFDocument } = await import("pdf-lib");
  const preset = STRONG_PRESETS[strongPreset(settings.strongPreset)];
  const output = await PDFDocument.create();
  await forEachRenderedPdfPage(
    {
      file: input,
      selection: "all",
      dpi: preset.dpi,
      background: "white",
      signal,
      color: colorMode(settings.color),
    },
    async (renderedPage, index, total) => {
      progress({
        completed: index,
        total,
        stage: "Rebuilding flattened page",
        stageMessage: { key: "progress.rebuildingFlattenedPage" },
      });
      const jpeg = await encodeCanvas(renderedPage.canvas, "jpg", preset.quality);
      const embedded = await output.embedJpg(jpeg);
      const page = output.addPage([renderedPage.pointWidth, renderedPage.pointHeight]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: renderedPage.pointWidth,
        height: renderedPage.pointHeight,
      });
      progress({ completed: index + 1, total, stage: "Page complete", stageMessage: { key: "progress.pageComplete" } });
    },
  );
  return output.save();
}

export default run;
