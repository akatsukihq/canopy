/**
 * Moved from `mergePdfs` in `app/media/_workers/pdf.worker.ts:191-217`, plus the
 * shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * The `{ merge: true }` flag came from `message.operation === "merge-pdf"`
 * (`pdf.worker.ts:95`); it is this tool's own statement now. The order used to
 * arrive as `options.order`, a list of file ids `buildJobOptions` built from the
 * UI file list (`MediaWorkbench.tsx:1620-1621`); it is `ctx.input.items` here.
 */

import {
  addCopiedPagesWithProgress,
  enforcePageLimit,
  loadPdf,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun, type ToolRunFile } from "../../lib/tool-framework/run.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validatePdfSelection(
    ctx.input.files.map((file) => ({ size: file.size })),
    { merge: true },
  );
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  for (const file of ctx.input.files) await validatePdfInput(file);

  const { PDFDocument } = await import("pdf-lib");
  const output = await PDFDocument.create();
  const items = ctx.input.items;
  const ordered: readonly ToolRunFile[] =
    items && items.length > 0
      ? items.map((item) => {
          const input = ctx.input.files.find((file) => file.id === item.id);
          if (!input) {
            throw new ToolError("invalid-order", "The selected PDF order is invalid.", undefined, {
              messageRef: { key: "errors.invalidOrder" },
            });
          }
          return input;
        })
      : ctx.input.files;

  let totalPages = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    ctx.signal.throwIfAborted();
    ctx.progress({
      completed: index,
      total: ordered.length,
      stage: "Copying PDF pages",
      stageMessage: { key: "progress.copyingPdfPages" },
    });
    const source = await loadPdf(ordered[index]);
    totalPages += source.getPageCount();
    enforcePageLimit(ordered[index], totalPages, false);
    await addCopiedPagesWithProgress(output, source, source.getPageIndices(), "Copying PDF page", ctx.progress, {
      key: "progress.copyingPdfPage",
    });
  }

  const merged = await ctx.writeArtifact({
    name: createOutputFilename(ordered[0].name, "pdf", "merged"),
    mime: "application/pdf",
    source: await output.save(),
  });

  return {
    render: "files",
    files: [merged],
    inputBytes: ctx.input.files.reduce((sum, file) => sum + file.size, 0),
    outputBytes: merged.size,
  };
};

export default run;
