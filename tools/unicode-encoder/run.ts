/**
 * Moved verbatim from the `unicode-encoder` case in
 * `lib/devtools/format-json.ts` (arm at line 2536). This is the encoder
 * counterpart of `decodeUnicodeEscapes` (format-json.ts:3732), which belongs
 * to the separate `unicode-decoder` tool; the encoder has only this consumer,
 * so it lives here rather than in `lib/devtools/shared/`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  language: "unicode",
  text: Array.from(ctx.input.text, (character) => {
    const point = character.codePointAt(0)!;
    return point <= 0x7f
      ? character
      : point <= 0xffff
        ? `\\u${point.toString(16).padStart(4, "0")}`
        : `\\u{${point.toString(16)}}`;
  }).join(""),
});

export default run;
