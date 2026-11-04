import { diffLines } from "../../lib/devtools/shared/line-diff.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly repairMode: string;
};

function formatJson(value: unknown, indent = ""): string {
  // Bound recursion and indentation before the quadratic line-alignment check.
  if (indent.length > 256) {
    throw new ToolError(
      "comparison-too-deep",
      "This JSON is nested too deeply to compare safely.",
      "Compare smaller nested sections.",
      {
        messageRef: { key: "execution.errors.comparison-too-deep" },
        recoveryMessage: { key: "execution.recovery.comparison-too-deep" },
      },
    );
  }
  const nextIndent = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length
      ? `[\n${value.map((item) => `${nextIndent}${formatJson(item, nextIndent)}`).join(",\n")}\n${indent}]`
      : "[]";
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return keys.length
      ? `{\n${keys.map((key) => `${nextIndent}${JSON.stringify(key)}: ${formatJson(value[key], nextIndent)}`).join(",\n")}\n${indent}}`
      : "{}";
  }
  // JSON.parse preserves negative zero and can overflow a valid exponent.
  if (Object.is(value, -0)) return "-0";
  if (value === Infinity) return "1e400";
  if (value === -Infinity) return "-1e400";
  return JSON.stringify(value) ?? "null";
}

function parseSide(input: string, settings: Settings, label: "JSON A" | "JSON B"): string {
  try {
    return formatJson(
      parseUtilityJson(input, { repairMode: settings.repairMode }, label, label === "JSON A" ? "left" : "right"),
    );
  } catch (error) {
    if (error instanceof ToolError && !error.message.startsWith(label)) {
      throw new ToolError(error.code, `${label}: ${error.message}`, error.recovery, {
        ...error.details,
        ...(error.code === "comparison-too-deep"
          ? { messageRef: { key: "execution.errors.comparisonTooDeepSide", values: { side: label } } }
          : {}),
      });
    }
    throw error;
  }
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const lines = diffLines(
    parseSide(ctx.input.text, ctx.settings, "JSON A"),
    parseSide(ctx.input.secondary ?? "", ctx.settings, "JSON B"),
  );
  const added = lines.filter(({ kind }) => kind === "added").length;
  const removed = lines.filter(({ kind }) => kind === "removed").length;
  return {
    render: "diff",
    lines,
    leftLabel: "JSON A · Original",
    leftLabelMessage: { key: "execution.original" },
    rightLabel: "JSON B · Changed",
    rightLabelMessage: { key: "execution.changedSide" },
    downloadName: "json-diff.txt",
    verdict: {
      level: "ok",
      label:
        added || removed
          ? `${added} ${added === 1 ? "line" : "lines"} added · ${removed} ${removed === 1 ? "line" : "lines"} removed`
          : "No differences",
      labelMessage:
        added || removed ? { key: "execution.changed", values: { added, removed } } : { key: "execution.identical" },
      detail: "Comparing JSON B against JSON A. Formatting and object key order are ignored.",
      detailMessage: { key: "execution.comparison" },
    },
  };
};

export default run;
