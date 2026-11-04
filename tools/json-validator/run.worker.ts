import { jsonType, parseStrictJson } from "../../lib/devtools/shared/json-input.ts";
import { isLargeJsonRun, validateStreamingJsonRun } from "../../lib/devtools/shared/streaming-json-tool.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  if (isLargeJsonRun(ctx)) return validateStreamingJsonRun(ctx);
  await validateStreamingJsonRun(ctx);
  const value = parseStrictJson(ctx.input.text, "JSON input");
  return {
    render: "text",
    text: `Valid JSON\nRoot type: ${jsonType(value)}`,
    verdict: {
      level: "ok",
      label: "Valid JSON",
      labelMessage: { key: "execution.valid" },
      detail: `Root type: ${jsonType(value)}`,
      detailMessage: { key: "execution.rootType", values: { type: jsonType(value) } },
    },
  };
};

export default run;
