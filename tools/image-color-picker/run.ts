import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { decodeImage, paletteFromPixels, pixelColorValues } from "./model.ts";

type Settings = {
  readonly x: number;
  readonly y: number;
  readonly colors: number;
};
export const run: ToolRun<Settings> = async (ctx) => {
  const file = ctx.input.files?.[0]?.source;
  if (!file)
    throw new ToolError("missing-image", "Choose an image to sample its colors.", undefined, {
      messageRef: { key: "image.missing" },
    });
  const image = await decodeImage(file, ctx.signal);
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(Number(ctx.settings.x) || 0)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(Number(ctx.settings.y) || 0)));
  const pixel = pixelColorValues(image.canvas, x, y);
  const palette = paletteFromPixels(image.palettePixels, ctx.settings.colors || 6);
  return {
    render: "text",
    text: `:root {\n  --sampled-color: ${pixel.hex};${palette.map((entry, index) => `\n  --image-color-${index + 1}: ${entry.hex};`).join("")}\n}`,
    downloadName: "image-palette.css",
    stats: [
      { label: "Width", labelMessage: { key: "image.width" }, value: String(image.width) },
      { label: "Height", labelMessage: { key: "image.height" }, value: String(image.height) },
    ],
    sections: [
      {
        title: "Selected pixel",
        titleMessage: { key: "image.pixel" },
        body: {
          render: "key-value",
          entries: pixel.entries,
        },
      },
      {
        title: "Approximate palette",
        titleMessage: { key: "image.palette" },
        body: {
          render: "table",
          columns: ["HEX", "Visible share"],
          columnMessages: [undefined, { key: "image.visibleShare" }],
          rows: palette.map((entry) => [entry.hex, `${entry.share}%`]),
        },
      },
    ],
  };
};
export default run;
