/** Parses CSV rows into the shared structured table result renderer. */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";
import { CSV_PREVIEW_BYTES } from "../../lib/tool-framework/limits.ts";
import { parseUtilityTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";

type Settings = {
  readonly delimiter: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  if (isLargeCsvRun(ctx)) {
    const parsed = await parseCsvRun(ctx, {
      delimiter,
      maxPreviewBytes: CSV_PREVIEW_BYTES,
      previewRows: 1_001,
    });
    const [columns = [], ...rows] = parsed.preview;
    return {
      render: "table",
      columns,
      rows: rows.slice(0, 1_000),
      showColumnDividers: true,
      truncated: parsed.previewTruncated,
      stats: [
        { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(Math.max(0, parsed.rowCount - 1)) },
        { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(parsed.columnCount) },
      ],
    };
  }
  const [columns, ...rows] = parseUtilityTable(ctx.input.text, delimiter);
  return {
    render: "table",
    columns,
    rows,
    showColumnDividers: true,
  };
};

export default run;
