/**
 * Moved from the `duplicate-word-remover` case in
 * `lib/devtools/format-json.ts` with one deliberate fix: the legacy arm
 * collapsed runs of whitespace with `/\s{2,}/` but never trimmed, so removing
 * the *final* word left a trailing separator behind (a single space that
 * `\s{2,}` cannot match). The captured fixture recorded that trailing space;
 * it has been updated along with this `.trim()`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const seen = new Set<string>();
  return {
    render: "text",
    text: ctx.input.text
      .split(/(\s+)/u)
      .filter((part) => {
        if (/^\s+$/u.test(part)) return true;
        const key = part.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("")
      .replace(/\s{2,}/g, " ")
      .trim(),
  };
};

export default run;
