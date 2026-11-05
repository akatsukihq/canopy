import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { resolveJsonPath } from "./json-path.ts";

type Settings = {
  readonly repairMode: string;
  readonly path: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return {
    render: "text",
    text: JSON.stringify(resolveJsonPath(value, ctx.settings.path), null, 2),
  };
};

export default run;
