/**
 * Moved from `addPageNumbers` in `app/media/_workers/pdf.worker.ts:611-638`,
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `buildJobOptions` assembled `position` from two separate options
 * (`MediaWorkbench.tsx:1602`, `1658-1659`); the `position` field kind holds the
 * combined nine-point anchor directly, so the two collapse into one setting and
 * `positionedBox` takes it unchanged.
 */

import {
  enforcePageLimit,
  loadPdf,
  positionedBox,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { WatermarkPosition } from "../../lib/tool-framework/settings.ts";
import { parseHexColor } from "../../lib/devtools/shared/color.ts";

type Settings = {
  readonly format: string;
  readonly start: number;
  readonly fontSize: number;
  readonly textColor: string;
  readonly position: WatermarkPosition;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validatePdfSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  for (const file of ctx.input.files) await validatePdfInput(file);

  const { StandardFonts, rgb } = await import("pdf-lib");
  const input = ctx.input.files[0];
  const pdf = await loadPdf(input);
  enforcePageLimit(input, pdf.getPageCount(), false);
  ctx.signal.throwIfAborted();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { red, green, blue } = parseHexColor(ctx.settings.textColor);
  const color = rgb(red / 255, green / 255, blue / 255);
  const total = pdf.getPageCount();
  pdf.getPages().forEach((page, index) => {
    const number = ctx.settings.start + index;
    const value =
      ctx.settings.format === "page-number"
        ? `Page ${number}`
        : ctx.settings.format === "number-of-total"
          ? `${number} / ${ctx.settings.start + total - 1}`
          : String(number);
    const width = font.widthOfTextAtSize(value, ctx.settings.fontSize);
    ctx.progress({
      completed: index,
      total,
      stage: "Numbering PDF page",
      stageMessage: { key: "progress.numberingPdfPage" },
    });
    page.drawText(value, {
      ...positionedBox(page, width, ctx.settings.fontSize, ctx.settings.position),
      color,
      font,
      size: ctx.settings.fontSize,
    });
    ctx.progress({
      completed: index + 1,
      total,
      stage: "Page complete",
      stageMessage: { key: "progress.pageComplete" },
    });
  });
  const numbered = await ctx.writeArtifact({
    name: createOutputFilename(input.name, "pdf", "numbered"),
    mime: "application/pdf",
    source: await pdf.save(),
  });

  return {
    render: "files",
    files: [numbered],
    inputBytes: input.size,
    outputBytes: numbered.size,
  };
};

export default run;
