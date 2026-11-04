/**
 * Moved verbatim from the `csv-formatter` case in
 * `lib/devtools/format-json.ts` (arm at line 2216).
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityTable, serializeTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { isLargeCsvRun, streamCsvRows } from "../../lib/devtools/shared/streaming-csv-tool.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";

type Settings = {
  readonly delimiter: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  if (isLargeCsvRun(ctx)) {
    return streamCsvRows(ctx, {
      inputDelimiter: delimiter,
      mapRow: (row) => row.map((cell) => cell.trim()),
      mime: "text/plain",
      name: "formatted-data.txt",
      outputDelimiter: delimiter,
    });
  }
  const rows = parseUtilityTable(ctx.input.text, delimiter).map((row) => row.map((cell) => cell.trim()));
  return {
    render: "text",
    text: serializeTable(rows, delimiter),
    tablePreview: createTablePreview(rows[0], rows.slice(1)).result,
    downloadName: "formatted-data.txt",
  };
};

export default run;
