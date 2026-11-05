/**
 * Moved verbatim from the `json-array-to-table` case in the legacy devtools
 * runtime. `flattenRecord` is the shared helper in `lib/devtools/shared/csv.ts`
 * — the same one `convertJsonToCsv` flattens rows with.
 */

import { flattenRecord } from "../../lib/devtools/shared/csv.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { tableToHtml } from "../../lib/devtools/shared/table.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly repairMode: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, { repairMode: ctx.settings.repairMode });
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new ToolError(
      "shape",
      "JSON input must be an array of objects.",
      "Wrap a single object in [] or point the tool at the list inside your response.",
      { messageRef: { key: "execution.errors.shape" }, recoveryMessage: { key: "execution.recovery.shape" } },
    );
  }
  const rows = value.map((row) => flattenRecord(row));
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length)
    throw new ToolError("empty-columns", "JSON array objects need at least one field.", undefined, {
      messageRef: { key: "execution.errors.empty-columns" },
    });
  const tableRows = rows.map((row) => columns.map((column) => String(row[column] ?? "")));
  return {
    render: "html",
    html: tableToHtml([columns, ...tableRows]),
    tablePreview: { render: "table", columns, rows: tableRows, showColumnDividers: true },
    downloadName: "table.html",
  };
};

export default run;
