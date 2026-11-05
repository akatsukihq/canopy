/**
 * Moved verbatim from the `regex-tester` case in
 * `lib/devtools/format-json.ts` (line 2800).
 *
 * GUARDS — preserved exactly, none removed:
 *  - the flag string is validated against /^[dgimsuvy]*$/ and rejected if it
 *    repeats a flag or combines `u` with `v`;
 *  - `g` is force-appended so `exec` advances;
 *  - a zero-length match bumps `lastIndex` so the loop cannot spin forever;
 *  - the match list is capped at 10,000 and the run is rejected at the cap.
 *
 * The source had NO timeout or backtracking guard, and none is added here —
 * adding one would change behaviour. A catastrophically backtracking pattern
 * still blocks the thread inside a single `exec` call, which the match cap
 * cannot prevent. That limitation is documented in the tool's stored spec
 * (`content.limitations`) rather than silently papered over.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly flags: string;
};

type RegexMatch = {
  index: number;
  match: string;
  groups: Record<string, string> | null;
};

const MAX_MATCHES = 10_000;

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const { flags } = ctx.settings;
  if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
    throw new ToolError(
      "invalid-flags",
      "Regex flags are invalid.",
      "Use any combination of d g i m s u v y, each at most once.",
      { messageRef: { key: "errors.invalid-flags" }, recoveryMessage: { key: "recovery.invalid-flags" } },
    );
  }
  if (flags.includes("u") && flags.includes("v")) {
    throw new ToolError(
      "conflicting-flags",
      "Regex flags u and v cannot be combined.",
      "Keep either u or v, not both.",
      { messageRef: { key: "errors.conflicting-flags" }, recoveryMessage: { key: "recovery.conflicting-flags" } },
    );
  }

  let expression: RegExp;
  try {
    expression = new RegExp(
      requireUtilityInput(ctx.input.text, "Regex pattern"),
      flags.includes("g") ? flags : `${flags}g`,
    );
  } catch (error) {
    throw new ToolError(
      "invalid-pattern",
      `Regex pattern is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      "Enter the pattern body without the surrounding slashes.",
      {
        ...(error instanceof ToolError ? error.details : undefined),
        messageRef:
          error instanceof ToolError && error.details?.messageRef
            ? error.details.messageRef
            : error instanceof Error
              ? { key: "errors.invalid-pattern", values: { detail: error.message } }
              : { key: "errors.invalid-pattern-unknown" },
        recoveryMessage: { key: "recovery.invalid-pattern" },
      },
    );
  }

  const matches: RegexMatch[] = [];
  let match: RegExpExecArray | null;
  const subject = ctx.input.secondary ?? "";
  const unicode = flags.includes("u") || flags.includes("v");
  while ((match = expression.exec(subject)) && matches.length < MAX_MATCHES) {
    matches.push({
      index: match.index,
      match: match[0],
      groups: match.groups ? { ...match.groups } : null,
    });
    if (!match[0]) {
      // Unicode matching must not resume inside a surrogate pair.
      const codePoint = subject.codePointAt(expression.lastIndex);
      expression.lastIndex += unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
  }
  if (matches.length === MAX_MATCHES) {
    throw new ToolError(
      "too-many-matches",
      "Regex produced too many matches; narrow the pattern.",
      `Anchor the pattern or make it more specific — the result is capped at ${MAX_MATCHES.toLocaleString("en-US")} matches.`,
      {
        messageRef: { key: "errors.too-many-matches" },
        recoveryMessage: { key: "recovery.too-many-matches", values: { count: MAX_MATCHES } },
      },
    );
  }

  return {
    render: "text",
    text: JSON.stringify({ count: matches.length, matches }, null, 2),
  };
};

export default run;
