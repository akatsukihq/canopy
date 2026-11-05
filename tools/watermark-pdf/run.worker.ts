/**
 * Moved from `watermarkPdf` (`app/media/_workers/pdf.worker.ts:526-609`), plus
 * the shared preflight from `processPdf` (`pdf.worker.ts:91-98`) and the
 * per-tool `getPdfInputs` branch (`pdf.worker.ts:843-851`), which excluded the
 * watermark image from PDF validation. That branch was this tool's own logic,
 * so it lives here now as `partitionInputs`.
 *
 * SECOND FILE INPUT. `ToolRunContext.input.files` is a list, and the watermark
 * image is simply another entry in it. The two are told apart by CONTENT
 * SIGNATURE (`detectMediaKind`), not by position and not by the declared MIME:
 * position is not stable across a re-pick, and a declared MIME is caller-
 * supplied. The cost is that `input.accept` must also list `image/jpeg` and
 * `image/png`, because the shared `assertRunnableFiles` checks every file
 * against it.
 */

import { clamp } from "../../lib/tool-framework/media/imageCodec.ts";
import { readExifOrientation } from "../../lib/tool-framework/media/geometry.ts";
import { readToolFile } from "../../lib/tool-framework/media/fileBytes.ts";
import {
  enforcePageLimit,
  loadPdf,
  positionedBox,
  resolvePageSelection,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import {
  createOutputFilename,
  validateDecodedImageDimensions,
  validateImageSelection,
  validateMediaSignature,
  validatePdfSelection,
} from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun, type ToolRunFile } from "../../lib/tool-framework/run.ts";
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

type Partitioned = {
  readonly document: ToolRunFile | null;
  readonly watermark: ToolRunFile | null;
};

/** Replaces `getPdfInputs` (`pdf.worker.ts:843-851`), by content not by id. */
function partitionInputs(files: readonly ToolRunFile[]): Partitioned {
  let document: ToolRunFile | null = null;
  let watermark: ToolRunFile | null = null;
  for (const file of files) {
    if (file.mime === "application/pdf" || /\.pdf$/i.test(file.name)) {
      document ??= file;
    } else {
      watermark ??= file;
    }
  }
  return { document, watermark };
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const { document, watermark } = partitionInputs(ctx.input.files);
  if (!document)
    throw new ToolError("no-files", "Choose a PDF to watermark.", undefined, { messageRef: { key: "errors.noFiles" } });
  const selection = validatePdfSelection([{ size: document.size }]);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(document);

  const { StandardFonts, degrees, rgb } = await import("pdf-lib");
  const pdf = await loadPdf(document);
  enforcePageLimit(document, pdf.getPageCount(), false);
  const selected = resolvePageSelection(ctx.settings.pages, pdf.getPageCount());
  ctx.signal.throwIfAborted();

  if (ctx.settings.watermarkKind === "text") {
    const text = ctx.settings.watermarkText;
    if (!text.trim()) {
      throw new ToolError("empty-watermark", "Enter watermark text.", undefined, {
        messageRef: { key: "errors.emptyWatermark" },
      });
    }
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    try {
      font.encodeText(text);
    } catch {
      throw new ToolError(
        "unsupported-text",
        "This text cannot be encoded by the standard PDF font. Use an image watermark for this text.",
        undefined,
        { messageRef: { key: "errors.unsupportedText" } },
      );
    }
    selected.forEach((index) => {
      const page = pdf.getPage(index);
      const width = font.widthOfTextAtSize(text, ctx.settings.watermarkSize);
      const height = ctx.settings.watermarkSize;
      const position = positionedBox(page, width, height, ctx.settings.position);
      page.drawText(text, {
        ...position,
        color: rgb(0.35, 0.35, 0.35),
        font,
        opacity: clamp(ctx.settings.opacity / 100, 0.05, 1),
        rotate: degrees(ctx.settings.watermarkRotation),
        size: ctx.settings.watermarkSize,
      });
    });
  } else {
    if (!watermark) {
      throw new ToolError("missing-watermark", "Choose a watermark image.", undefined, {
        messageRef: { key: "errors.missingWatermark" },
      });
    }
    const watermarkBytes = await readToolFile(watermark, ctx.signal);
    const signature = validateMediaSignature(new Uint8Array(watermarkBytes), watermark.mime, ["jpeg", "png"]);
    if (!signature.ok) throw new ToolError(signature.code, signature.message, undefined, signature.details);
    const watermarkSelection = validateImageSelection([{ size: watermark.size }]);
    if (!watermarkSelection.ok) {
      throw new ToolError(watermarkSelection.code, watermarkSelection.message, undefined, watermarkSelection.details);
    }
    const decoded =
      signature.kind === "jpeg"
        ? await (
            await import("@jsquash/jpeg")
          ).decode(watermarkBytes, {
            preserveOrientation: true,
          })
        : await (await import("@jsquash/png")).decode(watermarkBytes);
    const dimensions = validateDecodedImageDimensions(decoded.width, decoded.height);
    if (!dimensions.ok) throw new ToolError(dimensions.code, dimensions.message, undefined, dimensions.details);
    const orientedJpeg = signature.kind === "jpeg" && readExifOrientation(new Uint8Array(watermarkBytes)) !== 1;
    const embeddedBytes = orientedJpeg
      ? await (await import("@jsquash/jpeg")).encode(decoded, { quality: 92 })
      : watermarkBytes;
    const image = signature.kind === "jpeg" ? await pdf.embedJpg(embeddedBytes) : await pdf.embedPng(embeddedBytes);
    ctx.signal.throwIfAborted();
    selected.forEach((index) => {
      const page = pdf.getPage(index);
      const width = (page.getWidth() * clamp(ctx.settings.watermarkSize, 1, 100)) / 100;
      const height = width * (image.height / image.width);
      const position = positionedBox(page, width, height, ctx.settings.position);
      page.drawImage(image, {
        ...position,
        width,
        height,
        opacity: clamp(ctx.settings.opacity / 100, 0.05, 1),
        rotate: degrees(ctx.settings.watermarkRotation),
      });
    });
  }

  ctx.progress({
    completed: selected.length,
    total: selected.length,
    stage: "Saving PDF",
    stageMessage: { key: "progress.savingPdf" },
  });
  const output = await ctx.writeArtifact({
    name: createOutputFilename(document.name, "pdf", "watermarked"),
    mime: "application/pdf",
    source: await pdf.save(),
  });
  return {
    render: "files",
    files: [output],
    inputBytes: document.size,
    outputBytes: output.size,
  };
};

export default run;
