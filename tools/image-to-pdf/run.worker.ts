/**
 * Moved from `createPdfFromImages` in `app/media/_workers/image.worker.ts:283-362`,
 * with `pdfPageSize` (`image.worker.ts:590-602`, used by this tool alone) and
 * the shared preflight from `run` (`image.worker.ts:88-89`).
 *
 * `options.items` was `files.map(({ id, rotation }) => ({ id, rotation }))` in
 * `buildJobOptions` (`MediaWorkbench.tsx:1614`); it is now `ctx.input.items`,
 * which falls back to unrotated files when the layout supplies no per-item
 * state. `options.quality` came from `raw.pdfQuality`
 * (`MediaWorkbench.tsx:1611`) and is the `quality` setting here.
 * `IMAGE_TO_PDF_QUALITY_PRESETS` is inlined from `app/media/_lib/tools.ts:321-325`.
 */

import {
  decodeImage,
  encodeImage,
  flattenImage,
  rotateImage,
  type DecodableImageKind,
} from "../../lib/tool-framework/media/imageCodec.ts";
import { fitRect, readExifOrientation } from "../../lib/tool-framework/media/geometry.ts";
import { readToolFile } from "../../lib/tool-framework/media/fileBytes.ts";
import {
  clipEndOperators,
  clipStartOperators,
  getPdfContentBox,
  hasTransparentPixels,
} from "../../lib/tool-framework/media/pdfRules.ts";
import { sanitizeFileName, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun, type ToolRunItem } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly page: string;
  readonly orientation: string;
  readonly margin: string;
  readonly fit: string;
  readonly quality: string;
  readonly background: string;
  readonly filename: string;
};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];
const PDF_LIB_MAX_INPUT_BYTES = 50 * 1024 * 1024;

/** Inlined from `app/media/_lib/tools.ts:321-325`. */
const QUALITY_PRESETS: Readonly<Record<string, { readonly quality: number; readonly reencode: boolean }>> = {
  original: { quality: 1, reencode: false },
  balanced: { quality: 0.82, reencode: true },
  small: { quality: 0.65, reencode: true },
};

const MARGINS: Readonly<Record<string, number>> = { none: 0, small: 18, normal: 36 };

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const inputBytes = ctx.input.files.reduce((sum, file) => sum + file.size, 0);
  if (inputBytes > PDF_LIB_MAX_INPUT_BYTES) {
    throw new ToolError(
      "total-too-large",
      "Images selected for one PDF must total 50 MiB or less.",
      "Remove images or create more than one PDF.",
      { messageRef: { key: "errors.totalTooLarge" }, recoveryMessage: { key: "recovery.totalTooLarge" } },
    );
  }
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const items: readonly Pick<ToolRunItem, "id" | "rotation">[] =
    ctx.input.items ?? ctx.input.files.map((file) => ({ id: file.id, rotation: 0 as const }));

  const pdfLib = await import("pdf-lib");
  const { PDFDocument } = pdfLib;
  const pdf = await PDFDocument.create();
  const inputs = items.map((item) => {
    const file = ctx.input.files.find(({ id }) => id === item.id);
    if (!file)
      throw new ToolError("invalid-order", "The selected image order is invalid.", undefined, {
        messageRef: { key: "errors.invalidOrder" },
      });
    return { file, rotation: item.rotation };
  });
  const quality = QUALITY_PRESETS[ctx.settings.quality] ?? QUALITY_PRESETS.balanced;
  const margin = MARGINS[ctx.settings.margin] ?? MARGINS.small;
  const total = inputs.length;

  for (let index = 0; index < inputs.length; index += 1) {
    ctx.signal.throwIfAborted();
    ctx.progress({
      completed: index,
      total,
      stage: "Adding image to PDF",
      stageMessage: { key: "progress.addingImageToPdf" },
    });
    const { file, rotation } = inputs[index];
    const decoded = await decodeImage(file, ALLOWED);
    const sourceBytes = await readToolFile(file, ctx.signal);
    const image = rotation ? rotateImage(decoded.image, rotation) : decoded.image;
    const hasExifOrientation = decoded.kind === "jpeg" && readExifOrientation(new Uint8Array(sourceBytes)) !== 1;
    const flattenOriginalPng =
      decoded.kind === "png" && !quality.reencode && !rotation && hasTransparentPixels(image.data);
    const embeddedBytes = flattenOriginalPng
      ? await encodeImage(flattenImage(image, ctx.settings.background), "png", 1, ctx.settings.background)
      : quality.reencode || rotation || hasExifOrientation || !["jpeg", "png"].includes(decoded.kind)
        ? await encodeImage(image, "jpeg", quality.quality, ctx.settings.background)
        : sourceBytes;
    const embedded =
      !quality.reencode && !rotation && !hasExifOrientation && decoded.kind === "png"
        ? await pdf.embedPng(embeddedBytes)
        : await pdf.embedJpg(embeddedBytes);
    const pageSize = pdfPageSize(ctx.settings.page, ctx.settings.orientation, image.width, image.height, margin);
    const page = pdf.addPage([pageSize.width, pageSize.height]);
    const inner = getPdfContentBox(pageSize.width, pageSize.height, margin);
    const placement = fitRect(
      { width: image.width, height: image.height },
      inner,
      ctx.settings.fit === "fill" ? "cover" : "contain",
    );
    if (ctx.settings.fit === "fill") {
      page.pushOperators(...clipStartOperators(inner, pdfLib));
    }
    page.drawImage(embedded, {
      x: inner.x + placement.x,
      y: inner.y + placement.y,
      width: placement.width,
      height: placement.height,
    });
    if (ctx.settings.fit === "fill") {
      page.pushOperators(...clipEndOperators(pdfLib));
    }
    ctx.progress({
      completed: index + 1,
      total,
      stage: "Page complete",
      stageMessage: { key: "progress.pageComplete" },
    });
  }

  const requestedName = sanitizeFileName(ctx.settings.filename, "converted-images.pdf");
  const filename = requestedName.toLowerCase().endsWith(".pdf") ? requestedName : `${requestedName}.pdf`;
  const output = await ctx.writeArtifact({
    name: filename,
    mime: "application/pdf",
    source: await pdf.save(),
  });

  return {
    render: "files",
    files: [output],
    inputBytes,
    outputBytes: output.size,
  };
};

/** Moved verbatim from `app/media/_workers/image.worker.ts:590-602`. */
function pdfPageSize(
  page: string,
  orientation: string,
  imageWidth: number,
  imageHeight: number,
  margin: number,
): { width: number; height: number } {
  let width = page === "a4" ? 595.28 : page === "letter" ? 612 : imageWidth * 0.75 + margin * 2;
  let height = page === "a4" ? 841.89 : page === "letter" ? 792 : imageHeight * 0.75 + margin * 2;
  const desired = orientation === "auto" ? (imageWidth > imageHeight ? "landscape" : "portrait") : orientation;
  if ((desired === "landscape") !== width > height) [width, height] = [height, width];
  return { width, height };
}

export default run;
