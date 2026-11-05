import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { formatDelimitedCode } from "../../lib/devtools/shared/code.ts";

type Settings = {
  readonly indentWidth: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const indent = ctx.settings.indentWidth === "4" ? "    " : ctx.settings.indentWidth === "tab" ? "\t" : "  ";
  const text = formatDelimitedCode(ctx.input.text, "javascript", indent);
  return { render: "text", text, downloadName: "formatted.js" };
};

export default run;
