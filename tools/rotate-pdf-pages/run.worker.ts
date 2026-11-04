/**
 * Moved from `rotatePdfPages` (`app/media/_workers/pdf.worker.ts:315-335`),
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `quarterTurn` (`MediaWorkbench.tsx:1715-1717`) narrowed the raw option to
 * 90/180/270 before it reached the worker. The select's closed choice list does
 * that now, and `quarter` below is the same fallback for a hostile value that
 * survived `parseSettings`.
 */

import {
  enforcePageLimit,
  loadPdf,
  reportStructuralProgress,
  resolvePageSelection,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { processStructuralPages } from "../../lib/tool-framework/media/pdfRules.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
  readonly degrees: string;
  readonly rotateSelectedOnly: boolean;
};

function quarter(value: string): 90 | 180 | 270 {
  return value === "180" ? 180 : value === "270" ? 270 : 90;
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files?.[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to rotate.", undefined, { messageRef: { key: "errors.noFiles" } });
  const selection = validatePdfSelection([{ size: input.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const { degrees } = await import("pdf-lib");
  const pdf = await loadPdf(input);
  enforcePageLimit(input, pdf.getPageCount(), false);
  const selected = ctx.settings.rotateSelectedOnly
    ? resolvePageSelection(ctx.settings.pages, pdf.getPageCount())
    : pdf.getPageIndices();
  const turn = quarter(ctx.settings.degrees);
  ctx.signal.throwIfAborted();

  await processStructuralPages(
    selected,
    (index) => index + 1,
    "Rotating PDF page",
    reportStructuralProgress(ctx.progress),
    (index) => {
      ctx.signal.throwIfAborted();
      const page = pdf.getPage(index);
      page.setRotation(degrees((page.getRotation().angle + turn) % 360));
    },
    { key: "progress.rotatingPdfPage" },
  );

  const output = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "rotated"),
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
