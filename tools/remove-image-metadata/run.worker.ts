/**
 * Moved from the `remove-image-metadata` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:111-207`.
 *
 * The input allowlist (`allowedKinds`, image.worker.ts:604) is stated here now.
 * This tool never overrode the format, so it keeps the old default,
 * `resolveOutputFormat("original", kind)` — which maps HEIC to JPEG, because
 * there is no HEIC encoder. `optionQuality({})` was 0.8 and
 * `optionString({}, "background", "#ffffff")` was `#ffffff`; both are passed
 * explicitly rather than left to the library defaults so the values stay
 * visible next to the `pngEffort` of 6.
 */

import {
  decodeImage,
  encodeImage,
  extensionFor,
  mimeFor,
  resolveOutputFormat,
  type DecodableImageKind,
} from "../../lib/tool-framework/media/imageCodec.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const total = ctx.input.files.length;
  const files = await writeArtifactBatch(
    ctx,
    {
      archiveName: createOutputFilename(ctx.input.files[0].name, "zip", "metadata-removed"),
      count: total,
    },
    async (write) => {
      for (let index = 0; index < total; index += 1) {
        ctx.signal.throwIfAborted();
        ctx.progress({
          completed: index,
          total,
          stage: "Decoding image",
          stageMessage: { key: "progress.decodingImage" },
        });
        const input = ctx.input.files[index];
        const { image, kind } = await decodeImage(input, ALLOWED);
        const format = resolveOutputFormat("original", kind);
        ctx.progress({
          completed: index,
          total,
          stage: "Encoding image",
          stageMessage: { key: "progress.encodingImage" },
        });
        const buffer = await encodeImage(image, format, 0.8, "#ffffff", 6);
        await write({
          name: createOutputFilename(input.name, extensionFor(format), "metadata-removed"),
          mime: mimeFor(format),
          source: new Uint8Array(buffer),
        });
        ctx.progress({
          completed: index + 1,
          total,
          stage: "Image complete",
          stageMessage: { key: "progress.imageComplete" },
        });
      }
    },
  );

  return {
    render: "files",
    files,
    inputBytes: ctx.input.files.reduce((sum, file) => sum + file.size, 0),
    outputBytes: files.reduce((sum, output) => sum + output.size, 0),
  };
};

export default run;
