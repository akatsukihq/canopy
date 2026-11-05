import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { shadowValue } from "./model.ts";

type Settings = {
  readonly layers: string;
  readonly previewBackground: string;
  readonly previewObject: string;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly inset: boolean;
  readonly additionalLayers: string;
  readonly linkOpacity: boolean;
  readonly showBrowserPrefixes: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const declaration = `box-shadow: ${shadowValue(ctx.input.text, ctx.settings)};`;
  return {
    render: "text",
    text: ctx.settings.showBrowserPrefixes ? `-webkit-${declaration}\n${declaration}` : declaration,
    downloadName: "box-shadow.css",
  };
};
export default run;
