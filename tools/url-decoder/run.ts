/**
 * Moved verbatim from the `url-decoder` case in
 * `lib/devtools/format-json.ts`, including the fact that the legacy `try`
 * wraps `requireUtilityInput` as well as `decodeURIComponent` — so empty input
 * reports the malformed-escape message rather than "Encoded input is
 * required.". Preserved rather than "fixed": no fixture covers it and this
 * migration is a move.
 */

import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  try {
    return {
      render: "text",
      text: decodeURIComponent(requireUtilityInput(ctx.input.text, "Encoded input")),
    };
  } catch {
    throw new ToolError(
      "invalid-escape",
      "URL input contains an invalid percent escape.",
      "Check for a stray % or an escape that is not followed by two hex digits.",
      { messageRef: { key: "errors.invalid-escape" }, recoveryMessage: { key: "recovery.invalid-escape" } },
    );
  }
};

export default run;
