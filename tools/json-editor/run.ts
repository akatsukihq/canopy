/**
 * Moved verbatim from the `json-editor` case in `lib/devtools/format-json.ts`.
 * The repair pass is the shared `parseUtilityJson`, not a reimplementation.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";

type Settings = {
  readonly repairMode: string;
  readonly indent: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const indentation = ctx.settings.indent === "4" ? 4 : 2;
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return {
    render: "code",
    code: JSON.stringify(value, null, indentation),
    language: "json",
    downloadName: "edited.json",
  };
};

export default run;
