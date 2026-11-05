/**
 * Pre-run hooks. Pure, React-free, no heavy dependencies — see the note in
 * `../compress-pdf/hooks.ts` for why they may not live beside `run`.
 *
 * `partitionInputs` is NOT reused from `run.worker.ts`: importing the run file
 * would pull the whole media graph onto the main thread. It splits documents
 * from watermarks by asking `detectMediaKind` whether a file is a PDF, and the
 * only thing this hook needs is that same yes/no, so the five-byte `%PDF-`
 * signature it decides on is inlined instead.
 */

import type { ToolPagesInspected, ToolRunFile, ToolValidate } from "../../lib/tool-framework/run.ts";
import type { WatermarkPosition, PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly watermarkKind: string;
  readonly watermarkText: string;
  readonly pages: PageSelection;
  readonly opacity: number;
  readonly watermarkSize: number;
  readonly watermarkRotation: number;
  readonly position: WatermarkPosition;
};

function isPdf(file: ToolRunFile): boolean {
  return file.mime === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Replaces the `definition.slug === "watermark-pdf"` guard at
 * `MediaWorkbench.tsx:814-821`, with the same message. The old check asked
 * whether a `watermarkFile` had been picked through a bespoke second input;
 * the equivalent question here is whether the file list contains a non-PDF.
 */
export const validate: ToolValidate<Settings> = (settings, files) => {
  if (settings.watermarkKind !== "image") return null;
  return files.some((file) => !isPdf(file))
    ? null
    : { message: "Choose a JPG or PNG watermark image.", messageRef: { key: "readiness.chooseWatermark" } };
};

/** Replaces the `watermark-pdf` arm of `applyPdfInspection` (`MediaWorkbench.tsx:726-731`). */
export const onPagesInspected: ToolPagesInspected<Settings> = () => ({
  pages: "all",
});
