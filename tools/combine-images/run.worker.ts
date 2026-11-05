/**
 * Moved from `combineImages` in `app/media/_workers/image.worker.ts:209-281`,
 * with the shared preflight from `run` (`image.worker.ts:88-89`).
 *
 * `options.order` was the UI's file-id list built in `buildJobOptions`
 * (`MediaWorkbench.tsx:1692`); it is now `ctx.input.items`, which falls back to
 * the file order when the layout does not supply per-item state. `quality` was
 * `number(raw.quality, 80) / 100` in the same place; the percentage is now the
 * setting and the division stays at the encode call.
 */

import {
  assertCanvasSize,
  canvasFromImage,
  context2d,
  decodeImage,
  encodeImage,
  extensionFor,
  fitImage,
  imageFromCanvas,
  mimeFor,
  safeColor,
  type DecodableImageKind,
  type OutputImageFormat,
} from "../../lib/tool-framework/media/imageCodec.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun, type ToolRunFile } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly layout: string;
  readonly columns: number;
  readonly cellSizing: string;
  readonly gap: number;
  readonly background: string;
  readonly outputFormat: string;
  readonly quality: number;
};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];

function outputFormat(value: string): OutputImageFormat {
  if (value === "jpeg") return "jpeg";
  if (value === "webp") return "webp";
  return "png";
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const ordered: readonly ToolRunFile[] = ctx.input.items
    ? ctx.input.items.map((item) => {
        const file = ctx.input.files.find((candidate) => candidate.id === item.id);
        if (!file)
          throw new ToolError("invalid-order", "The selected image order is invalid.", undefined, {
            messageRef: { key: "errors.invalidOrder" },
          });
        return file;
      })
    : ctx.input.files;

  const total = ordered.length;
  const format = outputFormat(ctx.settings.outputFormat);
  const background = ctx.settings.background;
  const dimensions: { height: number; width: number }[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    ctx.progress({
      completed: index,
      total,
      stage: "Reading image dimensions",
      stageMessage: { key: "progress.readingImageDimensions" },
    });
    const decoded = await decodeImage(ordered[index], ALLOWED);
    dimensions.push({ width: decoded.image.width, height: decoded.image.height });
  }
  const gap = Math.max(0, Math.round(ctx.settings.gap));
  const columns = Math.min(Math.max(1, Math.round(ctx.settings.columns)), dimensions.length);
  const rows = Math.ceil(dimensions.length / columns);
  const cellWidth = Math.max(...dimensions.map(({ width }) => width));
  const cellHeight = Math.max(...dimensions.map(({ height }) => height));
  const width =
    ctx.settings.layout === "horizontal"
      ? dimensions.reduce((sum, image) => sum + image.width, 0) + gap * (dimensions.length - 1)
      : ctx.settings.layout === "vertical"
        ? cellWidth
        : cellWidth * columns + gap * (columns - 1);
  const height =
    ctx.settings.layout === "vertical"
      ? dimensions.reduce((sum, image) => sum + image.height, 0) + gap * (dimensions.length - 1)
      : ctx.settings.layout === "horizontal"
        ? cellHeight
        : cellHeight * rows + gap * (rows - 1);
  assertCanvasSize(width, height);
  const canvas = new OffscreenCanvas(width, height);
  const context = context2d(canvas);
  context.fillStyle = safeColor(background);
  context.fillRect(0, 0, width, height);
  let offset = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    ctx.signal.throwIfAborted();
    ctx.progress({
      completed: index,
      total,
      stage: "Compositing image",
      stageMessage: { key: "progress.compositingImage" },
    });
    const image = (await decodeImage(ordered[index], ALLOWED)).image;
    const placed =
      ctx.settings.layout === "grid" && ctx.settings.cellSizing !== "centered"
        ? await fitImage(
            image,
            { width: cellWidth, height: cellHeight },
            ctx.settings.cellSizing === "fill" ? "cover" : "contain",
            background,
          )
        : image;
    const source = canvasFromImage(placed);
    const x =
      ctx.settings.layout === "horizontal"
        ? offset
        : ctx.settings.layout === "vertical"
          ? (cellWidth - placed.width) / 2
          : (index % columns) * (cellWidth + gap) + (cellWidth - placed.width) / 2;
    const y =
      ctx.settings.layout === "vertical"
        ? offset
        : ctx.settings.layout === "horizontal"
          ? (cellHeight - placed.height) / 2
          : Math.floor(index / columns) * (cellHeight + gap) + (cellHeight - placed.height) / 2;
    context.drawImage(source, x, y);
    offset += (ctx.settings.layout === "horizontal" ? image.width : image.height) + gap;
    source.width = 1;
    source.height = 1;
  }
  const image = imageFromCanvas(canvas);
  canvas.width = 1;
  canvas.height = 1;
  const buffer = await encodeImage(image, format, ctx.settings.quality / 100, background);
  const output = await ctx.writeArtifact({
    name: createOutputFilename(ordered[0].name, extensionFor(format), "combined"),
    mime: mimeFor(format),
    source: new Uint8Array(buffer),
  });
  ctx.progress({ completed: total, total, stage: "Image complete", stageMessage: { key: "progress.imageComplete" } });

  return {
    render: "files",
    files: [output],
    inputBytes: ctx.input.files.reduce((sum, file) => sum + file.size, 0),
    outputBytes: output.size,
  };
};

export default run;
