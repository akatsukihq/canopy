/**
 * Moved verbatim from the `hex-to-rgb` case in `lib/devtools/format-json.ts`.
 * Parsing is the shared `parseHexColor`; the alpha rounding
 * (`Number(alpha.toFixed(3))`) is preserved exactly.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseHexColor } from "../../lib/devtools/shared/color.ts";

type Settings = {
  readonly includeAlpha: boolean;
  readonly commaSyntax: boolean;
  readonly outputFormat: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const includeAlpha = ctx.settings.includeAlpha ?? true;
  const commaSyntax = ctx.settings.commaSyntax ?? true;
  const convert = (input: string) => {
    const color = parseHexColor(input);
    const alpha = Number(color.alpha.toFixed(3));
    const hasAlpha = includeAlpha && color.alpha < 1;
    const channels = commaSyntax
      ? `${color.red}, ${color.green}, ${color.blue}${hasAlpha ? `, ${alpha}` : ""}`
      : `${color.red} ${color.green} ${color.blue}${hasAlpha ? ` / ${alpha}` : ""}`;
    return (ctx.settings.outputFormat ?? "css") === "channels"
      ? channels
      : `${hasAlpha && commaSyntax ? "rgba" : "rgb"}(${channels})`;
  };

  const lines = ctx.input.text
    .split(/\r?\n/)
    .map((input, index) => ({ input: input.trim(), line: index + 1 }))
    .filter(({ input }) => input);
  if (lines.length <= 1) return { render: "text", text: convert(lines[0]?.input ?? "") };

  const items: string[] = [];
  const labels: string[] = [];
  const issues: NonNullable<ToolResult["issues"]>[number][] = [];
  for (const line of lines) {
    try {
      items.push(convert(line.input));
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
    labels,
    items,
    issues: issues.length ? issues : undefined,
  };
};

export default run;
