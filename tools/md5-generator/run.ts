/**
 * Moved verbatim from the `md5-generator` case in
 * `lib/devtools/format-json.ts` (arm at line 2557), including the same `md5`
 * package it already imported (format-json.ts:4).
 *
 * MD5 is a legacy checksum, not a security primitive. It is moved unchanged on
 * purpose: "upgrading" the algorithm or appending a warning to the result would
 * change the output, and the whole point of this tool is matching a digest a
 * legacy system already published.
 */

import md5 from "md5";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: md5(ctx.input.text),
});

export default run;
