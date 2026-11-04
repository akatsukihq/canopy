/**
 * Moved verbatim from the `base64-encoder` case in
 * `lib/devtools/format-json.ts`. The encoder is the shared `encodeBase64`,
 * including its base64url post-processing.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { encodeBase64 } from "../../lib/devtools/shared/encoding.ts";

type Settings = {
  readonly urlSafe: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: encodeBase64(ctx.input.text, ctx.settings.urlSafe),
  downloadName: "encoded-base64.txt",
});

export default run;
