/**
 * Moved from the `heic-to-png` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:111-207`.
 *
 * The input allowlist (`allowedKinds`, image.worker.ts:604) and the PNG output
 * format that the operation name used to imply are both stated here now. The
 * encoder defaults (quality 0.8, background `#ffffff`, pngEffort 6) match what
 * the old worker passed for this operation.
 */

import { decodeImage, encodeImage, type DecodableImageKind } from "../../lib/tool-framework/media/imageCodec.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {};

const ALLOWED: readonly DecodableImageKind[] = ["heic"];

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const total = ctx.input.files.length;
  const files = await writeArtifactBatch(
    ctx,
    {
      archiveName: createOutputFilename(ctx.input.files[0].name, "zip", "converted"),
      count: total,
      retainEntries: true,
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
        const { image } = await decodeImage(input, ALLOWED);
        ctx.progress({
          completed: index,
          total,
          stage: "Encoding image",
          stageMessage: { key: "progress.encodingImage" },
        });
        const buffer = await encodeImage(image, "png");
        await write({
          name: createOutputFilename(input.name, "png", "converted"),
          mime: "image/png",
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
    outputBytes: files[0].size,
  };
};

export default run;
