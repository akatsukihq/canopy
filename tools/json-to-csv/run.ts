import { convertJsonToCsv } from "../../lib/devtools/shared/csv.ts";
import { utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly repairMode: string;
  readonly delimiter: string;
};

const MAX_PREVIEW_ROWS = 1_000;
const MAX_PREVIEW_CELLS = 10_000;

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const repairMode = ctx.settings.repairMode === "null" ? "null" : ctx.settings.repairMode === "off" ? "off" : "remove";
  const result = convertJsonToCsv(ctx.input.text, {
    delimiter: utilityDelimiter(ctx.settings.delimiter),
    repairMode,
  });
  if (!result.ok) {
    throw new ToolError(
      result.error.kind,
      result.error.message,
      "Check the JSON shape, syntax, and selected options, then try again.",
      { messageRef: result.error.messageRef, recoveryMessage: { key: "execution.recovery.conversion" } },
    );
  }

  const previewRowLimit = Math.min(
    MAX_PREVIEW_ROWS,
    Math.max(1, Math.floor(MAX_PREVIEW_CELLS / Math.max(1, result.columns.length))),
  );

  return {
    render: "text",
    text: result.output,
    downloadName: "data.csv",
    tablePreview: {
      render: "table",
      columns: result.columns,
      rows: result.rows.slice(0, previewRowLimit),
      showColumnDividers: true,
      truncated: result.rows.length > previewRowLimit,
    },
    stats: [
      { label: "Rows", labelMessage: { key: "execution.rows" }, value: String(result.rowCount) },
      { label: "Columns", labelMessage: { key: "execution.columns" }, value: String(result.columns.length) },
      ...(result.repaired
        ? [
            {
              label: "Repaired",
              labelMessage: { key: "execution.repaired" },
              value: "Yes",
              valueMessage: { key: "execution.yes" },
            },
          ]
        : []),
    ],
  };
};

export default run;
