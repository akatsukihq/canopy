/**
 * Moved verbatim from the `text-to-binary` case in
 * `lib/devtools/format-json.ts` (arm at line 2523).
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: [...new TextEncoder().encode(ctx.input.text)].map((byte) => byte.toString(2).padStart(8, "0")).join(" "),
});

export default run;
