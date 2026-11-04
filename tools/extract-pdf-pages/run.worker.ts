/**
 * Moved from `extractPdfPages` in `app/media/_workers/pdf.worker.ts:271-289`,
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `buildJobOptions` sent a plain number list (`MediaWorkbench.tsx:1628-1629`),
 * so the handler called `checkedPages`. The `pages` field can also hold `"all"`,
 * so `resolvePageSelection` is used instead — for a number list it is
 * `checkedPages`, with the same validation and the same 0-based indexes.
 */

import {
  addCopiedPagesWithProgress,
  enforcePageLimit,
  loadPdf,
  resolvePageSelection,
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
  const selection = validatePdfSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  for (const file of ctx.input.files) await validatePdfInput(file);

  const { PDFDocument } = await import("pdf-lib");
  const input = ctx.input.files[0];
  const source = await loadPdf(input);
  enforcePageLimit(input, source.getPageCount(), false);
  ctx.signal.throwIfAborted();
  const pages = resolvePageSelection(ctx.settings.pages, source.getPageCount());
  const output = await PDFDocument.create();
  await addCopiedPagesWithProgress(output, source, pages, "Extracting PDF page", ctx.progress, {
    key: "progress.extractingPdfPage",
  });
  const extracted = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "extracted"),
    mime: "application/pdf",
    source: await output.save(),
  });

  return {
    render: "files",
    files: [extracted],
    inputBytes: input.size,
    outputBytes: extracted.size,
  };
};

export default run;
