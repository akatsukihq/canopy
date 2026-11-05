/**
 * Moved from `reorderPdfPages` (`app/media/_workers/pdf.worker.ts:291-313`),
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * A reorder is a permutation, so the setting must be a concrete list: `"all"`,
 * `"odd"` and `"even"` carry no ordering and are rejected here rather than
 * quietly enumerated into document order.
 */

import {
  addCopiedPagesWithProgress,
  checkedPages,
  enforcePageLimit,
  loadPdf,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to reorder.", undefined, { messageRef: { key: "errors.noFiles" } });
  const selection = validatePdfSelection([{ size: input.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const order = ctx.settings.pages;
  if (typeof order === "string") {
    throw new ToolError("incomplete-order", "Include every PDF page exactly once in the new order.", undefined, {
      messageRef: { key: "errors.incompleteOrder" },
    });
  }

  const { PDFDocument } = await import("pdf-lib");
  const source = await loadPdf(input);
  const count = source.getPageCount();
  enforcePageLimit(input, count, false);
  const pages = checkedPages(order, count, false);
  if (pages.length !== count || new Set(pages).size !== count) {
    throw new ToolError("incomplete-order", "Include every PDF page exactly once in the new order.", undefined, {
      messageRef: { key: "errors.incompleteOrder" },
    });
  }
  ctx.signal.throwIfAborted();

  const output = await PDFDocument.create();
  await addCopiedPagesWithProgress(output, source, pages, "Reordering PDF page", ctx.progress, {
    key: "progress.reorderingPdfPage",
  });

  const file = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "reordered"),
    mime: "application/pdf",
    source: await output.save(),
  });
  return {
    render: "files",
    files: [file],
    inputBytes: input.size,
    outputBytes: file.size,
  };
};

export default run;
