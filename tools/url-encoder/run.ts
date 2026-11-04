/**
 * Moved verbatim from the `url-encoder` case in `lib/devtools/format-json.ts`
 * (arm at line 2500). The platform's own `encodeURIComponent` / `encodeURI`
 * are the implementation, as before — neither is reimplemented.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly component: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  language: "url-encoded",
  text: ctx.settings.component ? encodeURIComponent(ctx.input.text) : encodeURI(ctx.input.text),
});

export default run;
