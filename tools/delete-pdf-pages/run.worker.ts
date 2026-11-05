/**
 * Moved from `deletePdfPages` (`app/media/_workers/pdf.worker.ts:337-358`),
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `buildJobOptions` turned the raw string into page numbers with `pageList`
 * (`MediaWorkbench.tsx:1702-1706`) and threw a `RangeError` the workbench
 * caught. That parse is now `parsePageSelection`, and the failure is a
 * `ToolError` like every other.
 */

import {
  checkedPages,
  enforcePageLimit,
  loadPdf,
  reportStructuralProgress,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { processStructuralPages } from "../../lib/tool-framework/media/pdfRules.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { parsePageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to delete pages from.", undefined, {
      messageRef: { key: "errors.noFiles" },
    });
  const selection = validatePdfSelection([{ size: input.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const pdf = await loadPdf(input);
  const count = pdf.getPageCount();
  enforcePageLimit(input, count, false);

  const requested = parsePageSelection(ctx.settings.pages, count);
  const pages = checkedPages(requested === "all" ? Array.from({ length: count }, (_, i) => i + 1) : requested, count);
  if (pages.length >= count) {
    throw new ToolError("empty-document", "At least one PDF page must remain.", undefined, {
      messageRef: { key: "errors.emptyDocument" },
    });
  }
  ctx.signal.throwIfAborted();

  // Descending, so each removal leaves the indexes of the pages still to be
  // removed unchanged.
  const descending = [...pages].sort((a, b) => b - a);
  await processStructuralPages(
    descending,
    (index) => index + 1,
    "Deleting PDF page",
    reportStructuralProgress(ctx.progress),
    (index) => {
      ctx.signal.throwIfAborted();
      pdf.removePage(index);
    },
    { key: "progress.deletingPdfPage" },
  );

  const output = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "pages-deleted"),
    mime: "application/pdf",
    source: await pdf.save(),
  });
  return {
    render: "files",
    files: [output],
    inputBytes: input.size,
    outputBytes: output.size,
  };
};

export default run;
