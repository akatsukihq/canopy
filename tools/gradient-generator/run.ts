import type { ToolResult } from "../../lib/tool-framework/result.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import { gradientValue } from "./model.ts";

type Settings = {
  readonly stops: string;
  readonly radialShape: string;
  readonly radialX: number;
  readonly radialY: number;
  readonly type: string;
  readonly angle: number;
  readonly includeFallback: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const { value, fallback } = gradientValue(ctx.input.text, ctx.input.secondary ?? "", ctx.settings);
  return {
    render: "text",
    text: `${ctx.settings.includeFallback ? `background: ${fallback};\n` : ""}background: ${value};`,
    downloadName: "gradient.css",
  };
};

export default run;
