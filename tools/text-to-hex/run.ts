/**
 * Moved verbatim from the `text-to-hex` case in `lib/devtools/format-json.ts`.
 * The hex formatting is the shared `bytesToHex`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { bytesToHex } from "../../lib/devtools/shared/encoding.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: bytesToHex(new TextEncoder().encode(ctx.input.text)),
  downloadName: "hex-output.txt",
});

export default run;
