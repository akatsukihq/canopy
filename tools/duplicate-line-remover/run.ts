/**
 * Moved verbatim from the `duplicate-line-remover` case in
 * `lib/devtools/format-json.ts` (line 2331): the same split, the same optional
 * trim applied before the comparison, and the same `Set` of seen keys, so the
 * first occurrence wins and order is preserved.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly ci: boolean;
  readonly trim: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const seen = new Set<string>();
  const { trim, ci: insensitive } = ctx.settings;
  return {
    render: "text",
    text: ctx.input.text
      .split(/\r\n|\r|\n/)
      .map((line) => (trim ? line.trim() : line))
      .filter((line) => {
        const key = insensitive ? line.toLowerCase() : line;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("\n"),
    downloadName: "unique-lines.txt",
  };
};

export default run;
