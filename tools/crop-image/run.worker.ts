/**
 * Moved from the `crop-image` arm of `processImages`
 * (`app/media/_workers/image.worker.ts:111-206`, crop case at 155-161). The
 * loop is single-file here because this tool declares `multiple: false`.
 *
 * `image.worker.ts` derived the accepted kinds from the operation name via
 * `allowedKinds` (`image.worker.ts:604-612`); this tool states them itself, and
 * they match the `accept` list in its spec.
 */

import {
  cropImage,
  decodeImage,
  encodeImage,
  extensionFor,
  mimeFor,
  resolveOutputFormat,
  type OutputImageFormat,
} from "../../lib/tool-framework/media/imageCodec.ts";
import { createOutputFilename } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

import { parseCropPoints, selectionBounds } from "./geometry.ts";

/** Clip in source pixels, preserving alpha outside the selected polygon. */
function cropFreeform(image: ImageData, raw: unknown): ImageData {
  const points = parseCropPoints(raw, image);
  const bounds = selectionBounds(points);
  const source = new OffscreenCanvas(image.width, image.height);
  const canvas = new OffscreenCanvas(bounds.width, bounds.height);
  try {
    const sourceContext = source.getContext("2d");
    const context = canvas.getContext("2d");
    if (!sourceContext || !context)
      throw new ToolError("canvas-unavailable", "Unable to create the crop. Please try again.", undefined, {
        messageRef: { key: "errors.canvasUnavailable" },
      });
    sourceContext.putImageData(image, 0, 0);
    context.beginPath();
    points.forEach((point, index) => {
      const x = point.x - bounds.x;
      const y = point.y - bounds.y;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.clip();
    context.drawImage(source, -bounds.x, -bounds.y);
    return context.getImageData(0, 0, bounds.width, bounds.height);
  } finally {
    source.width = source.height = canvas.width = canvas.height = 1;
  }
}

type Settings = {
  readonly cropMode: string;
  readonly cropPointCount: number;
  readonly cropPoints: string;
  readonly cropAspect: string;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
  readonly outputFormat: string;
  readonly quality: number;
};

const ACCEPTED = ["jpeg", "png", "webp"] as const;

function outputFormat(requested: string): "original" | OutputImageFormat {
  return requested === "jpeg" || requested === "png" || requested === "webp" ? requested : "original";
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  if (!input)
    throw new ToolError("no-files", "Choose an image to crop.", undefined, { messageRef: { key: "errors.noFiles" } });

  ctx.progress({ completed: 0, total: 1, stage: "Decoding image", stageMessage: { key: "progress.decodingImage" } });
  const { image, kind } = await decodeImage(input, ACCEPTED);
  ctx.signal.throwIfAborted();

  const format = resolveOutputFormat(outputFormat(ctx.settings.outputFormat), kind);
  const cropped =
    ctx.settings.cropMode === "freeform"
      ? cropFreeform(image, ctx.settings.cropPoints)
      : cropImage(image, {
          x: ctx.settings.cropX,
          y: ctx.settings.cropY,
          width: ctx.settings.cropWidth,
          height: ctx.settings.cropHeight,
        });
  ctx.signal.throwIfAborted();

  ctx.progress({ completed: 0, total: 1, stage: "Encoding image", stageMessage: { key: "progress.encodingImage" } });
  const buffer = await encodeImage(cropped, format, ctx.settings.quality / 100);
  ctx.signal.throwIfAborted();
  const output = await ctx.writeArtifact({
    name: createOutputFilename(input.name, extensionFor(format), "cropped"),
    mime: mimeFor(format),
    source: new Uint8Array(buffer),
  });
  ctx.progress({ completed: 1, total: 1, stage: "Image complete", stageMessage: { key: "progress.imageComplete" } });

  return {
    render: "files",
    files: [output],
    inputBytes: input.size,
    outputBytes: output.size,
  };
};

export default run;
