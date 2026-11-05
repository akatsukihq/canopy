import { parseUtilityTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";

type Settings = {
  readonly delimiter: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  const parsed = isLargeCsvRun(ctx) ? await parseCsvRun(ctx, { delimiter, previewRows: 1 }) : null;
  const rows = parsed ? parsed.preview : parseUtilityTable(ctx.input.text, delimiter);
  const headers = (rows[0] ?? []).map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new ToolError("empty-header", "Every CSV column needs a header.", undefined, {
      messageRef: { key: "csv.errors.emptyHeader" },
    });
  }
  if (new Set(headers).size !== headers.length) {
    throw new ToolError("duplicate-header", "CSV headers must be unique.", undefined, {
      messageRef: { key: "csv.errors.duplicateHeader" },
    });
  }
  const dataRows = (parsed?.rowCount ?? rows.length) - 1;
  return {
    render: "text",
    text: `Valid CSV\nColumns: ${headers.length}\nData rows: ${dataRows}`,
    verdict: {
      level: "ok",
      label: "Valid CSV",
      labelMessage: { key: "csv.valid" },
      detail: `${headers.length} column${headers.length === 1 ? "" : "s"} · ${dataRows} data row${dataRows === 1 ? "" : "s"}`,
      detailMessage: {
        key: "csv.validDetail",
        values: { columns: headers.length, rows: dataRows },
      },
    },
  };
};

export default run;
