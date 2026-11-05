/** Precise HSL conversion with optional whole percentages and CSS syntax choices. */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseHexColor, rgbToHsl } from "../../lib/devtools/shared/color.ts";

type Settings = {
  readonly includeAlpha: boolean;
  readonly roundPercentages: boolean;
  readonly modernSyntax: boolean;
  readonly outputFormat: string;
};

function convert(input: string, settings: Settings): string {
  const color = parseHexColor(input);
  let text = rgbToHsl(settings.includeAlpha === false ? { ...color, alpha: 1 } : color, {
    percentagePrecision: settings.roundPercentages === true ? 0 : 3,
    syntax: settings.modernSyntax ? "modern" : "legacy",
  });
  if (settings.outputFormat === "channels") text = text.replace(/^hsla?\(|\)$/g, "");

  return text;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const lines = ctx.input.text
    .split(/\r?\n/)
    .map((input, index) => ({ input: input.trim(), line: index + 1 }))
    .filter(({ input }) => input);

  if (lines.length <= 1) return { render: "text", text: convert(lines[0]?.input ?? ctx.input.text, ctx.settings) };

  const items: string[] = [];
  const labels: string[] = [];
  const issues: NonNullable<ToolResult["issues"]>[number][] = [];
  for (const line of lines) {
    try {
      items.push(convert(line.input, ctx.settings));
      labels.push(line.input);
    } catch (error) {
      issues.push({
        line: line.line,
        message: `"${line.input}": ${error instanceof Error ? error.message : String(error)}`,
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
