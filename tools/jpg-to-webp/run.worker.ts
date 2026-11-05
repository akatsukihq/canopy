/**
 * Moved from the `jpg-to-webp` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:111-207`.
 *
 * The input allowlist (`allowedKinds`, image.worker.ts:604) and the WebP output
 * format that the operation name used to imply are both stated here now.
 * `quality` was `number(raw.quality, 80) / 100` in `buildJobOptions`
 * (`MediaWorkbench.tsx:1601`); the percentage is now the setting and the
 * division stays at the encode call.
 */

import { decodeImage, encodeImage, type DecodableImageKind } from "../../lib/tool-framework/media/imageCodec.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly quality: number;
};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg"];

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const quality = ctx.settings.quality / 100;
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
        const buffer = await encodeImage(image, "webp", quality);
        await write({
          name: createOutputFilename(input.name, "webp", "converted"),
          mime: "image/webp",
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
