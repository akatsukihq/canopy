/**
 * Moved verbatim from the `unicode-decoder` case and `decodeUnicodeEscapes`
 * in `lib/devtools/format-json.ts`. One consumer, so it stays in this folder.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

function decodeUnicodeEscapes(value: string): string {
  return value
    .replace(/\\u\{([\da-f]{1,6})\}/gi, (match, code: string) => {
      const point = Number.parseInt(code, 16);
      if (point > 0x10ffff) {
        throw new ToolError("out-of-range", "Unicode code point is out of range.", undefined, {
          messageRef: { key: "errors.out-of-range" },
        });
      }
      return String.fromCodePoint(point);
    })
    .replace(/\\u([\da-f]{4})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: decodeUnicodeEscapes(ctx.input.text),
});

export default run;
