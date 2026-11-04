/**
 * The folder-contract entry point. The parse itself is `executeJsonViewer` in
 * `./execution.ts`, unchanged — this file only maps its result onto a
 * `ToolResult`, so the workbench and this run stay on one implementation.
 *
 * `json-tree` carries both the parsed value and the pretty-printed text, which
 * is what lets the custom `workspace.tsx` keep rendering the interactive tree.
 */

import { executeJsonViewer } from "./execution.ts";
import {
  isLargeJsonRun,
  transformLargeJsonRun,
  validateStreamingJsonRun,
} from "../../lib/devtools/shared/streaming-json-tool.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly largeFileOperation: string;
  readonly repairMode: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  if (isLargeJsonRun(ctx)) {
    if (ctx.settings.largeFileOperation === "format") {
      return transformLargeJsonRun(ctx, {
        indentation: 2,
        mode: "format",
        name: "smarttools-json-viewer-formatted.json",
      });
    }
    if (ctx.settings.largeFileOperation === "minify") {
      return transformLargeJsonRun(ctx, {
        mode: "minify",
        name: "smarttools-json-viewer-minified.json",
      });
    }
    return validateStreamingJsonRun(ctx);
  }
  const result = executeJsonViewer(ctx.input.text);
  if (!result.ok) {
    throw new ToolError(
      `json-${result.error.kind}`,
      result.error.message,
      "Fix the reported line, or run Repair & clean to drop the broken parts.",
      {
        line: result.error.line,
        column: result.error.column,
        messageRef: {
          key: `errors.json-${result.error.kind}`,
          values:
            result.error.kind === "too-large"
              ? { limit: 2_000_000 }
              : result.error.line && result.error.column
                ? { line: result.error.line, column: result.error.column }
                : undefined,
        },
        recoveryMessage: { key: "execution.recovery.json" },
        values:
          result.error.kind === "too-large"
            ? { limit: 2_000_000 }
            : result.error.line && result.error.column
              ? { line: result.error.line, column: result.error.column }
              : undefined,
      },
    );
  }
  return {
    render: "json-tree",
    value: result.value,
    text: result.formattedValue,
  };
};

export default run;
