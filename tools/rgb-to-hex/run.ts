/** RGB-only input contract backed by the shared modern/legacy CSS color parser. */

import { parseColor, rgbToHex, type RgbColor } from "../../lib/devtools/shared/color.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly includeAlpha: boolean;
  readonly uppercaseOutput: boolean;
  readonly addHashPrefix: boolean;
};

function parseRgbColor(input: string): RgbColor {
  if (!/^rgba?\(/i.test(input.trim()))
    throw new ToolError("syntax", "Enter rgb() or rgba(), using commas or spaces with / alpha.", undefined, {
      messageRef: { key: "rgb.functionRequired" },
    });
  return parseColor(input);
}

function convert(input: string, settings: Settings): string {
  const color = parseRgbColor(input);
  let text = rgbToHex(settings.includeAlpha !== false ? color : { ...color, alpha: 1 });
  if (settings.uppercaseOutput === false) text = text.toLowerCase();
  if (settings.addHashPrefix === false) text = text.slice(1);
  return text;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const lines = ctx.input.text
    .split(/\r\n?|\n/)
    .map((input, index) => ({ input: input.trim(), line: index + 1 }))
    .filter(({ input }) => input);
  if (lines.length <= 1) {
    return { render: "text", text: convert(lines[0]?.input ?? ctx.input.text, ctx.settings) };
  }

  const items: string[] = [];
  const labels: string[] = [];
  const issues: NonNullable<ToolResult["issues"]>[number][] = [];
  for (const line of lines) {
    try {
      items.push(convert(line.input, ctx.settings));
      labels.push(line.input);
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      issues.push({
        line: line.line,
        message: `"${line.input}": ${error.message}`,
        target: "input",
        messageRef: error instanceof ToolError ? error.details?.messageRef : undefined,
      });
    }
  }
  return {
    render: "list",
    items,
    labels,
    issues: issues.length ? issues : undefined,
  };
};

export default run;
