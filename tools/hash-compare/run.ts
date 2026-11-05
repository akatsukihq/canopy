/**
 * Moved verbatim from the `hash-compare` case in
 * `lib/devtools/format-json.ts`, together with its `constantTimeEqual`
 * helper — this tool is that helper's only consumer (bcrypt-compare uses
 * `bcrypt.compare`, which does its own constant-time check), so it lives here
 * rather than in `lib/devtools/shared/`.
 *
 * The loop must keep running to the end of the longer value: an early `return`
 * on the first differing byte would reintroduce exactly the timing side channel
 * this tool exists to avoid. Never replace it with `===`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left.trim().toLowerCase());
  const rightBytes = new TextEncoder().encode(right.trim().toLowerCase());
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const matched = constantTimeEqual(ctx.input.text, ctx.input.secondary ?? "");
  return {
    render: "text",
    text: matched ? "Match" : "No match",
    verdict: matched
      ? { level: "ok", label: "Match", labelMessage: { key: "result.match" } }
      : { level: "error", label: "No match", labelMessage: { key: "result.noMatch" } },
  };
};

export default run;
