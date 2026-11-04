/**
 * Moved verbatim from the `bcrypt-compare` case in
 * `lib/devtools/format-json.ts`.
 *
 * The comparison stays `bcrypt.compare`, which is constant time; it is not
 * replaced with `===` and not short-circuited. The plain password is read once
 * and never appears in the result or in an error message. The import is dynamic
 * so `bcryptjs` stays out of the initial bundle.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  /**
   * Only the hash is trimmed. A bcrypt hash is a fixed `$2…$` string that never
   * contains whitespace, so stripping a pasted line ending is always safe. A
   * password is not: leading or trailing spaces can be part of the real secret,
   * and trimming them would make this tool report a match for a password that
   * does not actually match, which is the one answer it must never get wrong.
   */
  const password = requireUtilityInput(ctx.input.text, "Plain password");
  const hash = requireUtilityInput(ctx.input.secondary ?? "", "Bcrypt hash").trim();
  const { default: bcrypt } = await import("bcryptjs");
  ctx.signal.throwIfAborted();
  let matched: boolean;
  try {
    matched = await bcrypt.compare(password, hash);
  } catch {
    throw new ToolError(
      "hash-invalid",
      "Bcrypt hash is invalid.",
      "Paste the whole stored hash, including the $2b$ prefix and cost.",
      {
        messageRef: { key: "execution.errors.hash-invalid" },
        recoveryMessage: { key: "execution.recovery.hash-invalid" },
      },
    );
  }
  return {
    render: "text",
    text: matched ? "Match" : "No match",
    verdict: {
      level: matched ? "ok" : "warn",
      label: matched ? "Match" : "No match",
      labelMessage: { key: matched ? "execution.match" : "execution.noMatch" },
    },
  };
};

export default run;
