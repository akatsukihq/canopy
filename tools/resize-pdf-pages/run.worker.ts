/**
 * Moved from `resizePdfPages` in `app/media/_workers/pdf.worker.ts:388-458`,
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * Two changes beyond mechanical renames:
 *  - the `pageSize === "auto"` branch (`pdf.worker.ts:402-409`) is dropped.
 *    `buildJobOptions` could never send `"auto"` for this tool
 *    (`MediaWorkbench.tsx:1638-1647`), so it was dead, and with the four
 *    choices this spec declares it is not type-representable either.
 *  - `namedSize`/`fitMode` narrow the `select` values, which reach the run as
 *    `string`, back to the unions `pdfSize` and `fitRect` accept. `parseSettings`
 *    has already restricted them to the declared choices.
 */

import { fitRect, type FitMode } from "../../lib/tool-framework/media/geometry.ts";
import {
  enforcePageLimit,
  loadPdf,
  pdfSize,
  reportStructuralProgress,
  resolvePageSelection,
  validatePdfInput,
  type PdfNamedPageSize,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import {
  getPdfContentBox,
  processStructuralPages,
  wrapPageContentsWithClip,
} from "../../lib/tool-framework/media/pdfRules.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
  readonly pageSize: string;
  readonly width: number;
  readonly height: number;
  readonly orientation: string;
  readonly fit: string;
  readonly margin: number;
};

function namedSize(value: string): PdfNamedPageSize {
  return value === "letter" || value === "legal" || value === "custom" ? value : "a4";
}

function fitMode(value: string): FitMode {
  return value === "cover" || value === "stretch" ? value : "contain";
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validatePdfSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  for (const file of ctx.input.files) await validatePdfInput(file);

  const pdfLib = await import("pdf-lib");
  const { PDFArray, PDFDict, PDFName, PDFNumber } = pdfLib;
  const input = ctx.input.files[0];
  const pdf = await loadPdf(input);
  enforcePageLimit(input, pdf.getPageCount(), false);
  const fit = fitMode(ctx.settings.fit);
  const pages = resolvePageSelection(ctx.settings.pages, pdf.getPageCount());
  await processStructuralPages(
    pages,
    (index) => index + 1,
    "Resizing PDF page",
    reportStructuralProgress(ctx.progress),
    (index) => {
      ctx.signal.throwIfAborted();
      const page = pdf.getPage(index);
      const requested = pdfSize(namedSize(ctx.settings.pageSize), ctx.settings.width, ctx.settings.height);
      const target =
        ctx.settings.orientation === "landscape" && requested.width < requested.height
          ? { width: requested.height, height: requested.width }
          : ctx.settings.orientation === "portrait" && requested.width > requested.height
            ? { width: requested.height, height: requested.width }
            : requested;
      const inner = getPdfContentBox(target.width, target.height, ctx.settings.margin);
      const placement = fitRect({ width: page.getWidth(), height: page.getHeight() }, inner, fit);
      page.scaleContent(placement.scaleX, placement.scaleY);
      page.scaleAnnotations(placement.scaleX, placement.scaleY);
      const translateX = inner.x + placement.x;
      const translateY = inner.y + placement.y;
      page.translateContent(translateX, translateY);
      const annotations = page.node.Annots();
      if (annotations) {
        for (let annotationIndex = 0; annotationIndex < annotations.size(); annotationIndex += 1) {
          const annotation = annotations.lookupMaybe(annotationIndex, PDFDict);
          const rect = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
          if (!rect || rect.size() < 4) continue;
          const x1 = rect.lookupMaybe(0, PDFNumber);
          const y1 = rect.lookupMaybe(1, PDFNumber);
          const x2 = rect.lookupMaybe(2, PDFNumber);
          const y2 = rect.lookupMaybe(3, PDFNumber);
          if (!x1 || !y1 || !x2 || !y2) continue;
          rect.set(0, PDFNumber.of(x1.asNumber() + translateX));
          rect.set(1, PDFNumber.of(y1.asNumber() + translateY));
          rect.set(2, PDFNumber.of(x2.asNumber() + translateX));
          rect.set(3, PDFNumber.of(y2.asNumber() + translateY));
        }
      }
      page.setSize(target.width, target.height);
      if (fit === "cover") {
        wrapPageContentsWithClip(pdf, page, inner, pdfLib);
      }
    },
    { key: "progress.resizingPdfPage" },
  );
  const resized = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "resized"),
    mime: "application/pdf",
    source: await pdf.save(),
  });

  return {
    render: "files",
    files: [resized],
    inputBytes: input.size,
    outputBytes: resized.size,
  };
};

export default run;
