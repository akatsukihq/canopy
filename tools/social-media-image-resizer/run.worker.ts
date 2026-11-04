/**
 * Moved from the `social-media-image-resizer` arm of `processImages` in
 * `app/media/_workers/image.worker.ts:177-190`, with the shared preflight from
 * `image.worker.ts:88-89` and the per-file loop from `image.worker.ts:111-207`.
 *
 * The input allowlist (`allowedKinds`, image.worker.ts:604-611) is stated here
 * because it was always this tool's own. `SOCIAL_IMAGE_PRESETS` is inlined from
 * `app/media/_lib/tools.ts:333-361`. The output format, fit, and background all
 * come straight off the settings, exactly as `buildJobOptions` supplied them
 * (`MediaWorkbench.tsx:1693-1694`); the filename suffix stays the preset key.
 */

import {
  decodeImage,
  encodeImage,
  extensionFor,
  fitImage,
  mimeFor,
  type DecodableImageKind,
  type OutputImageFormat,
} from "../../lib/tool-framework/media/imageCodec.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import { createOutputFilename, validateImageSelection } from "../../lib/tool-framework/media/validation.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly preset: string;
  readonly fit: string;
  readonly background: string;
  readonly outputFormat: string;
  readonly quality: number;
};

const ALLOWED: readonly DecodableImageKind[] = ["jpeg", "png", "webp", "heic"];

const SOCIAL_IMAGE_PRESETS = {
  "instagram-square": {
    label: "Instagram square",
    width: 1080,
    height: 1080,
  },
  "instagram-portrait": {
    label: "Instagram portrait",
    width: 1080,
    height: 1350,
  },
  "story-reel": { label: "Story / Reel", width: 1080, height: 1920 },
  "youtube-thumbnail": {
    label: "YouTube thumbnail",
    width: 1280,
    height: 720,
  },
  "x-landscape": { label: "X landscape", width: 1600, height: 900 },
  "linkedin-landscape": {
    label: "LinkedIn landscape",
    width: 1200,
    height: 627,
  },
  "facebook-landscape": {
    label: "Facebook landscape",
    width: 1200,
    height: 630,
  },
} as const;

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const selection = validateImageSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);

  const suffix = ctx.settings.preset;
  const preset = SOCIAL_IMAGE_PRESETS[suffix as keyof typeof SOCIAL_IMAGE_PRESETS];
  const format = ctx.settings.outputFormat as OutputImageFormat;
  const fit = ctx.settings.fit as "contain" | "cover";
  const background = ctx.settings.background;
  const quality = ctx.settings.quality / 100;

  const total = ctx.input.files.length;
  const files = await writeArtifactBatch(
    ctx,
    {
      archiveName: createOutputFilename(ctx.input.files[0].name, "zip", suffix),
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
        const { image } = await decodeImage(input, ALLOWED);
        const fitted = await fitImage(image, { width: preset.width, height: preset.height }, fit, background);
        ctx.progress({
          completed: index,
          total,
          stage: "Encoding image",
          stageMessage: { key: "progress.encodingImage" },
        });
        const buffer = await encodeImage(fitted, format, quality, background);
        await write({
          name: createOutputFilename(input.name, extensionFor(format), suffix),
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
