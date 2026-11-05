/**
 * Moved verbatim from the `json-minifier` case in
 * `lib/devtools/format-json.ts` (line 2125): `parseUtilityJson` followed by a
 * `JSON.stringify` with no indent argument. The parse/repair step is the shared
 * helper, not a copy.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import {
  isLargeJsonRun,
  transformLargeJsonRun,
  transformSmallJson,
} from "../../lib/devtools/shared/streaming-json-tool.ts";

type Settings = {
  readonly repairMode: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  if (isLargeJsonRun(ctx)) {
    return transformLargeJsonRun(ctx, {
      mode: "minify",
      name: "minified.json",
    });
  }
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  const strictInput = JSON.stringify(value);
  const output = await transformSmallJson(strictInput, {
    mode: "minify",
    signal: ctx.signal,
  });
  return { render: "text", text: output, downloadName: "minified.json" };
};

export default run;
