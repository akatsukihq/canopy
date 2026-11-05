import { digestText } from "../../lib/devtools/shared/crypto.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const digest = await digestText(ctx.input.text, "SHA-512");
  ctx.signal.throwIfAborted();
  return { render: "text", text: digest };
};

export default run;
