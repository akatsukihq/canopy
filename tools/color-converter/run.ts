import { parseColor, rgbToHex, rgbToHsl } from "../../lib/devtools/shared/color.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly outputFormat: string;
  readonly includeAlpha: boolean;
  readonly modernSyntax: boolean;
  readonly precision: number;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const precision = Math.min(6, Math.max(0, Math.trunc(ctx.settings.precision ?? 3)));
  const convert = (input: string) => {
    const parsed = parseColor(input);
    const color = ctx.settings.includeAlpha === false ? { ...parsed, alpha: 1 } : parsed;
    const modern = ctx.settings.modernSyntax !== false;
    if (ctx.settings.outputFormat === "hsl")
      return rgbToHsl(color, { precision, syntax: modern ? "modern" : "legacy" });
    if (ctx.settings.outputFormat === "rgb") {
      const values = [color.red, color.green, color.blue].map((value) => Number(value.toFixed(precision)));
      const alpha = Number(color.alpha.toFixed(Math.max(3, precision)));
      if (modern) return `rgb(${values.join(" ")}${color.alpha < 1 ? ` / ${alpha}` : ""})`;
      return `${color.alpha < 1 ? "rgba" : "rgb"}(${values.join(", ")}${color.alpha < 1 ? `, ${alpha}` : ""})`;
    }
    return rgbToHex(color);
  };
  const lines = ctx.input.text
    .split(/\r\n?|\n/)
    .map((input, index) => ({ input: input.trim(), line: index + 1 }))
    .filter(({ input }) => input);
  if (lines.length <= 1) return { render: "text", text: convert(lines[0]?.input ?? "") };
  const items: string[] = [];
  const labels: string[] = [];
  const issues: NonNullable<ToolResult["issues"]>[number][] = [];
  for (const { input, line } of lines) {
    try {
      items.push(convert(input));
      labels.push(input);
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      issues.push({ line, message: error.message, target: "input", messageRef: error.details?.messageRef });
    }
  }
  return { render: "list", items, labels, ...(issues.length ? { issues } : {}) };
};

export default run;
