/**
 * Moved from `cropPdf` (`app/media/_workers/pdf.worker.ts:360-386`), plus the
 * shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `ctx.settings.pages` is passed straight to `resolvePageSelection`: `"odd"`
 * and `"even"` are intent, and `pdfDocument.ts` is the one place with the page
 * count needed to enumerate them.
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
  readonly cropX: number;
  readonly cropY: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to crop.", undefined, { messageRef: { key: "errors.noFiles" } });
  const selection = validatePdfSelection([{ size: input.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const pdf = await loadPdf(input);
  enforcePageLimit(input, pdf.getPageCount(), false);
  const pages = resolvePageSelection(ctx.settings.pages, pdf.getPageCount());
  await processStructuralPages(
    pages,
    (index) => index + 1,
    "Cropping PDF page",
    reportStructuralProgress(ctx.progress),
    (index) => {
      ctx.signal.throwIfAborted();
      const page = pdf.getPage(index);
      const x = Math.max(0, ctx.settings.cropX);
      const y = Math.max(0, ctx.settings.cropY);
      const width = ctx.settings.cropWidth || page.getWidth() - x;
      const height = ctx.settings.cropHeight || page.getHeight() - y;
      if (width <= 0 || height <= 0 || x + width > page.getWidth() || y + height > page.getHeight()) {
        throw new ToolError("invalid-crop", "The crop box must stay within every selected page.", undefined, {
          messageRef: { key: "errors.invalidCrop" },
        });
      }
      page.setCropBox(x, y, width, height);
    },
    { key: "progress.croppingPdfPage" },
  );

  const output = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "cropped"),
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
