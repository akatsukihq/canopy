/** Standalone sRGB color values, formatted according to the existing output options. */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseColor, rgbToHex, rgbToHsl } from "../../lib/devtools/shared/color.ts";
import { additionalColorFormats } from "./colorFormats.ts";

type Settings = {
  readonly normalizeShorthand: boolean;
  readonly legacyRgbCommas: boolean;
  readonly includeHsl: boolean;
  readonly outputFormat: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const color = parseColor(ctx.input.text);
  const channels = [color.red, color.green, color.blue].map((value) => Number(value.toFixed(3)));
  const alpha = Number(color.alpha.toFixed(3));
  const outputFormat = ctx.settings.outputFormat ?? "all";
  const rgb =
    (ctx.settings.legacyRgbCommas ?? true)
      ? color.alpha < 1
        ? `rgba(${channels.join(", ")}, ${alpha})`
        : `rgb(${channels.join(", ")})`
      : color.alpha < 1
        ? `rgb(${channels.join(" ")} / ${alpha})`
        : `rgb(${channels.join(" ")})`;
  const entries = [
    {
      format: "hex",
      label: "HEX",
      value:
        (ctx.settings.normalizeShorthand ?? true) || !/^#?[\da-f]{3,8}$/i.test(ctx.input.text.trim())
          ? rgbToHex(color)
          : `#${ctx.input.text.trim().replace(/^#/, "").toUpperCase()}`,
    },
    { format: "rgb", label: "RGB", value: rgb },
    ...((ctx.settings.includeHsl ?? true) || outputFormat === "hsl"
      ? [{ format: "hsl", label: "HSL", value: rgbToHsl(color) }]
      : []),
    ...additionalColorFormats(color),
  ];
  return {
    render: "key-value",
    entries: entries
      .filter(({ format }) => outputFormat === "all" || format === outputFormat)
      .map(({ label, value }) => ({ label, value })),
  };
};

export default run;
