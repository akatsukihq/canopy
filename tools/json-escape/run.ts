/**
 * Moved verbatim from the `json-escape` case in `lib/devtools/format-json.ts`
 * (arm at line 2184). `JSON.stringify` does the escaping; the slice drops the
 * wrapping quotes. Empty input yields an empty string, exactly as before —
 * there is deliberately no required-input guard here.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: JSON.stringify(ctx.input.text).slice(1, -1),
});

export default run;
