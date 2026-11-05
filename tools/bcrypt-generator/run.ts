/**
 * Moved verbatim from the `bcrypt-generator` case in
 * `lib/devtools/format-json.ts`: the same `bcryptjs` `hash`, the same cost
 * factor read straight from the setting, unchanged and never lowered.
 *
 * The password is read once, passed to `hash`, and never placed in the result,
 * a log line, or an error message. The import is dynamic so `bcryptjs` stays
 * out of the initial bundle.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly rounds: number;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const value = requireUtilityInput(ctx.input.text, "Password or text");
  const { default: bcrypt } = await import("bcryptjs");
  ctx.signal.throwIfAborted();
  return { render: "text", text: await bcrypt.hash(value, ctx.settings.rounds) };
};

export default run;
