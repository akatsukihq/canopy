/**
 * Moved from the `compress-image` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:139-147`, with the shared preflight from
 * `image.worker.ts:88-89` and the per-file loop from `image.worker.ts:111-207`.
 *
 * Two branches that used to be shared are stated here because they were always
 * this tool's own: the input allowlist (`allowedKinds`, image.worker.ts:604-611)
 * and the "keep the original format" output rule.
 *
 * `PNG_COMPRESSION_PRESETS` is inlined from `app/media/_lib/tools.ts:315-319`.
 * `quality` was `options.quality ?? (preset === ...)` where `buildJobOptions`
 * (`MediaWorkbench.tsx:1672-1673`) only set `options.quality` when the advanced
 * toggle was on; that condition is now read straight off the settings.
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

type Settings = {
  readonly preset: string;
  readonly advancedQuality: boolean;
  readonly quality: number;
};

/**
 * Kept verbatim from `allowedKinds`, which fell through to its default for this
 * operation. `heic` is unreachable in practice because the tool's `accept`
 * excludes it, but the allowlist is not the place to change that.
 */
const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];

const PNG_COMPRESSION_PRESETS = {
  fast: { effort: 3 },
  balanced: { effort: 6 },
  maximum: { effort: 9 },
} as const;

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const preset = ctx.settings.preset;
  const quality = ctx.settings.advancedQuality
    ? ctx.settings.quality / 100
    : preset === "best"
      ? 0.9
      : preset === "smallest"
        ? 0.6
        : 0.8;
  const pngEffort = PNG_COMPRESSION_PRESETS[preset as keyof typeof PNG_COMPRESSION_PRESETS]?.effort ?? 6;

  const total = ctx.input.files.length;
  const files = await writeArtifactBatch(
    ctx,
    {
      archiveName: createOutputFilename(ctx.input.files[0].name, "zip", "compressed"),
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
        const buffer = await encodeImage(image, format, quality, "#ffffff", pngEffort);
        await write({
          name: createOutputFilename(input.name, extensionFor(format), "compressed"),
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
