/**
 * Moved from the `rotate-image` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:162-167`, with the shared preflight from
 * `image.worker.ts:88-89` and the per-file loop from `image.worker.ts:111-207`.
 *
 * The input allowlist (`allowedKinds`, image.worker.ts:604-611) is stated here
 * because it was always this tool's own. `buildJobOptions`
 * (`MediaWorkbench.tsx:1687-1688`) passed the angle through `quarterTurn`; a
 * `FieldSpec` select carries strings, so the same narrowing happens with
 * `Number(...) as QuarterTurn` against the three declared choices.
 *
 * `background` is the constant `"#ffffff"`: `buildJobOptions` never sent one for
 * this tool, so `optionString(options, "background", "#ffffff")` in the old
 * worker always produced exactly that.
 */

import {
  decodeImage,
  encodeImage,
  extensionFor,
  mimeFor,
  resolveOutputFormat,
  rotateImage,
  type DecodableImageKind,
  type OutputImageFormat,
} from "../../lib/tool-framework/media/imageCodec.ts";
import type { QuarterTurn } from "../../lib/tool-framework/media/geometry.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly degrees: string;
  readonly outputFormat: string;
  readonly quality: number;
};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];

const BACKGROUND = "#ffffff";

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const degrees = Number(ctx.settings.degrees) as QuarterTurn;
  const quality = ctx.settings.quality / 100;

  const total = ctx.input.files.length;
  const files = await writeArtifactBatch(
    ctx,
    {
      archiveName: createOutputFilename(ctx.input.files[0].name, "zip", "rotated"),
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
        const format: OutputImageFormat = resolveOutputFormat(
          ctx.settings.outputFormat as "original" | OutputImageFormat,
          kind,
        );
        const rotated = rotateImage(image, degrees);
        ctx.progress({
          completed: index,
          total,
          stage: "Encoding image",
          stageMessage: { key: "progress.encodingImage" },
        });
        const buffer = await encodeImage(rotated, format, quality, BACKGROUND);
        await write({
          name: createOutputFilename(input.name, extensionFor(format), "rotated"),
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
