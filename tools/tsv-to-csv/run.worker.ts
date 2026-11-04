import { parseUtilityTable, serializeTable } from "../../lib/devtools/shared/table.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { isLargeCsvRun, streamCsvRows } from "../../lib/devtools/shared/streaming-csv-tool.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  if (isLargeCsvRun(ctx)) {
    return streamCsvRows(ctx, {
      inputDelimiter: "\t",
      mime: "text/csv",
      name: "table.csv",
      outputDelimiter: ",",
    });
  }
  const rows = parseUtilityTable(ctx.input.text, "\t");
  return {
    render: "text",
    text: serializeTable(rows, ","),
    tablePreview: createTablePreview(rows[0], rows.slice(1)).result,
    downloadName: "table.csv",
  };
};

export default run;
