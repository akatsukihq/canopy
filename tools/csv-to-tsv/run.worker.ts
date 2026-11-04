/**
 * Moved verbatim from the `csv-to-tsv` case in `lib/devtools/format-json.ts`.
 * Parsing and serialization are the shared table helpers, unchanged.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityTable, serializeTable } from "../../lib/devtools/shared/table.ts";
import { isLargeCsvRun, streamCsvRows } from "../../lib/devtools/shared/streaming-csv-tool.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";

type Settings = {};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  if (isLargeCsvRun(ctx)) {
    return streamCsvRows(ctx, {
      inputDelimiter: ",",
      mime: "text/tab-separated-values",
      name: "table.tsv",
      outputDelimiter: "\t",
    });
  }
  const rows = parseUtilityTable(ctx.input.text, ",");
  return {
    render: "text",
    text: serializeTable(rows, "\t"),
    tablePreview: createTablePreview(rows[0], rows.slice(1)).result,
    downloadName: "table.tsv",
  };
};

export default run;
