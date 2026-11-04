import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { CSV_PREVIEW_BYTES } from "../../lib/tool-framework/limits.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { csvCell, parseDelimitedRows } from "../../lib/devtools/shared/csv.ts";
import { parseUtilityTable, serializeTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { createTextArtifactSink, isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";

type Settings = {
  readonly delimiter: string;
  readonly column: string;
};

const MAX_PREVIEW_ROWS = 1_000;
const MAX_PREVIEW_CELLS = 10_000;

function createTablePreview(columns: string[]) {
  const encoder = new TextEncoder();
  const rowLimit = Math.min(MAX_PREVIEW_ROWS, Math.max(1, Math.floor(MAX_PREVIEW_CELLS / columns.length)));
  let remainingBytes =
    CSV_PREVIEW_BYTES - columns.reduce((size, column) => size + encoder.encode(column).byteLength, 0);
  const rows: string[][] = [];
  const result =
    remainingBytes < 0
      ? undefined
      : {
          render: "table" as const,
          columns,
          rows,
          showColumnDividers: true,
          truncated: false,
        };

  return {
    result,
    append(row: string[]) {
      if (!result || result.truncated) return;
      const rowBytes = row.reduce((size, cell) => size + encoder.encode(cell).byteLength, 0);
      if (rows.length >= rowLimit || rowBytes > remainingBytes) {
        result.truncated = true;
        return;
      }
      rows.push(row);
      remainingBytes -= rowBytes;
    },
  };
}

function resolveColumns(header: readonly string[], selection: string): number[] {
  const requested = selection.trim();
  if (!requested) {
    throw new ToolError("column-required", "Enter at least one column name or number.", undefined, {
      messageRef: { key: "csv.errors.columnRequired" },
    });
  }

  // Preserve exact names containing commas and the existing numeric-position behavior.
  const exactColumn = header.indexOf(requested);
  if (exactColumn !== -1 && !/^\d+$/.test(requested)) return [exactColumn];

  // Trim separator whitespace without changing commas or spaces inside quoted names.
  const normalized = requested.replace(/"(?:[^"]|"")*"|\s*,\s*/g, (token) => (token.startsWith('"') ? token : ","));
  const parsed = parseDelimitedRows(normalized, ",");
  const selectors = parsed.ok && parsed.rows.length === 1 ? parsed.rows[0] : [];
  if (!selectors.length || selectors.some((value) => !value)) {
    throw new ToolError(
      "invalid-column-selection",
      "Enter a name or number for every selected column, separated by commas.",
      'Wrap header names containing commas in double quotes, for example: "last,name",2.',
      {
        messageRef: { key: "csv.errors.columnSelection" },
        recoveryMessage: { key: "csv.recovery.columnSelection" },
      },
    );
  }

  return selectors.map((selector) => {
    const isPosition = /^\d+$/.test(selector);
    const column = isPosition ? Number(selector) - 1 : header.indexOf(selector);
    if (!Number.isSafeInteger(column) || column < 0 || column >= header.length) {
      throw new ToolError(
        "column-not-found",
        isPosition ? `Column number ${selector} is out of range.` : `Column ${JSON.stringify(selector)} was not found.`,
        `Use an exact header name, or a one-based column number from 1 to ${header.length}.`,
        {
          messageRef: {
            key: isPosition ? "csv.errors.columnNumberMissing" : "csv.errors.columnNameMissing",
            values: { column: isPosition ? selector : JSON.stringify(selector) },
          },
          recoveryMessage: { key: "csv.recovery.columnRange", values: { count: header.length } },
        },
      );
    }
    return column;
  });
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  if (isLargeCsvRun(ctx)) {
    const sink = createTextArtifactSink(ctx, {
      mime: "text/csv",
      name: "extracted-columns.csv",
    });
    let preview: ReturnType<typeof createTablePreview> | undefined;
    let columnIndexes: number[] = [];
    let columns: string[] = [];
    try {
      const parsed = await parseCsvRun(ctx, {
        delimiter,
        onRow: async (row, rowNumber) => {
          if (rowNumber === 1) {
            columnIndexes = resolveColumns(row, ctx.settings.column);
            columns = columnIndexes.map((column) => row[column]);
            preview = createTablePreview(columns);
          }
          const selected = columnIndexes.map((column) => row[column] ?? "");
          const value = selected.map((cell) => csvCell(cell, delimiter)).join(delimiter);
          if (rowNumber > 1) preview?.append(selected);
          await sink.write(`${rowNumber === 1 ? "" : "\n"}${value}`);
        },
        previewRows: 0,
      });
      if (!parsed.rowCount)
        throw new ToolError("empty-table", "Delimited input has no rows.", undefined, {
          messageRef: { key: "csv.errors.emptyTable" },
        });
      const artifact = await sink.finish();
      const rowCount = parsed.rowCount - 1;
      return {
        render: "text",
        text: sink.preview,
        truncated: sink.previewTruncated,
        tablePreview: preview?.result,
        stats: [
          { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(rowCount) },
          { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(columns.length) },
        ],
        artifacts: [artifact],
      };
    } catch (error) {
      await sink.abort(error);
      throw error;
    }
  }
  const [header, ...rows] = parseUtilityTable(ctx.input.text, delimiter);
  const columnIndexes = resolveColumns(header, ctx.settings.column);
  const columns = columnIndexes.map((column) => header[column]);
  const selectedRows = rows.map((row) => columnIndexes.map((column) => row[column]));
  const preview = createTablePreview(columns);
  for (const row of selectedRows) preview.append(row);
  return {
    render: "text",
    text: serializeTable([columns, ...selectedRows], delimiter),
    downloadName: "extracted-columns.csv",
    tablePreview: preview.result,
    stats: [
      { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(selectedRows.length) },
      { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(columns.length) },
    ],
  };
};

export default run;
