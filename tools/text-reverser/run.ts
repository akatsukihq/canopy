/**
 * Moved verbatim from the `text-reverser` case in
 * `lib/devtools/format-json.ts`. `Array.from` (not `split("")`) is what keeps
 * character mode code-point aware, so it is preserved exactly.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly mode: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const { mode } = ctx.settings;
  const text = ctx.input.text;
  return {
    render: "text",
    text:
      mode === "words"
        ? text.trim().split(/\s+/u).reverse().join(" ")
        : mode === "lines"
          ? text
              .split(/\r\n|\r|\n/u)
              .reverse()
              .join("\n")
          : Array.from(text).reverse().join(""),
    downloadName: "reversed-text.txt",
  };
};

export default run;
