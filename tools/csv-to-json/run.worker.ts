import { convertCsvToJson, parseDelimitedRows } from "../../lib/devtools/shared/csv.ts";
import { utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import type { ToolJsonTreeRender, ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { createTextArtifactSink, isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";
import { getRuntimeLimits } from "../../lib/tool-framework/limits.ts";

type Settings = {
  readonly delimiter: string;
  readonly firstRowAsHeaders: boolean;
  readonly parseNumbers: boolean;
  readonly trimWhitespace: boolean;
};
type JsonRow = Record<string, string | number> | (string | number)[];
const JSON_PREVIEW_MAX_NODES = 1_000;

function createJsonPreview() {
  const rows: JsonRow[] = [];
  const encoder = new TextEncoder();
  let nodes = 1;
  let bytes = 2;
  let truncated = false;
  return {
    addRow(value: JsonRow, json = JSON.stringify(value)) {
      if (truncated) return false;
      const rowNodes = Object.keys(value).length + 1;
      const rowBytes = encoder.encode(json).byteLength + (rows.length ? 1 : 0);
      if (nodes + rowNodes > JSON_PREVIEW_MAX_NODES || bytes + rowBytes > getRuntimeLimits().largeTextPreviewBytes) {
        truncated = true;
        return false;
      }
      // Match the exported JSON, including parseNumbers normalizing -0 to 0.
      rows.push(JSON.parse(json) as JsonRow);
      nodes += rowNodes;
      bytes += rowBytes;
      return true;
    },
    result(): ToolJsonTreeRender | undefined {
      if (truncated && rows.length === 0) return;
      return { render: "json-tree", value: rows, text: JSON.stringify(rows), truncated };
    },
  };
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  const preview = createJsonPreview();
  const normalizeCell = (value: string): string | number => {
    const normalized = ctx.settings.trimWhitespace ? value.trim() : value;
    return ctx.settings.parseNumbers && normalized.trim() !== "" && Number.isFinite(Number(normalized))
      ? Number(normalized)
      : normalized;
  };

  if (isLargeCsvRun(ctx)) {
    const sink = createTextArtifactSink(ctx, {
      mime: "application/json",
      name: "data.json",
    });
    const useHeaders = ctx.settings.firstRowAsHeaders !== false;
    let headers: readonly string[] = [];
    let outputRows = 0;
    try {
      await sink.write("[");
      const parsed = await parseCsvRun(ctx, {
        delimiter,
        onRow: async (row, rowNumber) => {
          if (useHeaders && rowNumber === 1) {
            headers = row.map((header) => header.trim());
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
            return;
          }
          const values = row.map(normalizeCell);
          if (ctx.settings.trimWhitespace && values.every((value) => value === "")) return;
          const value = useHeaders
            ? Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
            : values;
          const json = JSON.stringify(value);
          preview.addRow(value, json);
          await sink.write(`${outputRows === 0 ? "\n" : ",\n"}  ${json}`);
          outputRows += 1;
        },
        previewRows: 0,
      });
      if (parsed.rowCount === 0) {
        throw new ToolError("empty", "Paste CSV to convert it to JSON.", undefined, {
          messageRef: { key: "csv.errors.emptyJsonSource" },
        });
      }
      await sink.write(`${outputRows > 0 ? "\n" : ""}]`);
      const artifact = await sink.finish();
      const columnCount = useHeaders ? headers.length : parsed.columnCount;
      return {
        render: "code",
        code: sink.preview,
        language: "json",
        truncated: sink.previewTruncated,
        jsonPreview: preview.result(),
        stats: [
          { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(outputRows) },
          { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(columnCount) },
        ],
        sections: [
          {
            title: sink.previewTruncated ? "Complete JSON file" : "Download",
            titleMessage: { key: sink.previewTruncated ? "csv.completeJsonFile" : "csv.download" },
            body: { render: "files", files: [artifact], outputBytes: artifact.size },
          },
        ],
      };
    } catch (error) {
      await sink.abort(error);
      throw error;
    }
  }

  let output: string;
  let rowCount: number;
  let columnCount: number;

  if (ctx.settings.firstRowAsHeaders !== false) {
    const result = convertCsvToJson(ctx.input.text, { delimiter });
    if (!result.ok) {
      throw new ToolError(
        result.error.kind,
        result.error.message,
        "Check the delimiter, header row, quotes, and field counts, then try again.",
        {
          messageRef: result.error.messageRef,
          recoveryMessage: { key: "csv.recovery.jsonStructure" },
        },
      );
    }

    output = result.output;
    rowCount = result.rowCount;
    columnCount = result.columns.length;
    if (ctx.settings.trimWhitespace || ctx.settings.parseNumbers) {
      const rows = JSON.parse(result.output) as Array<Record<string, string>>;
      const normalizedRows = rows
        .map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, normalizeCell(value)])))
        .filter((row) => !ctx.settings.trimWhitespace || Object.values(row).some((value) => value !== ""));
      output = JSON.stringify(normalizedRows, null, 2);
      rowCount = normalizedRows.length;
    }
  } else {
    if (!ctx.input.text.trim()) {
      throw new ToolError("empty", "Paste CSV to convert it to JSON.", undefined, {
        messageRef: { key: "csv.errors.emptyJsonSource" },
      });
    }
    if (ctx.input.text.length > 2_000_000) {
      throw new ToolError("too-large", "CSV must be 2,000,000 characters or fewer.", undefined, {
        messageRef: { key: "csv.errors.inputTooLarge", values: { limit: 2_000_000 } },
      });
    }

    const parsed = parseDelimitedRows(ctx.input.text, delimiter);
    if (!parsed.ok) {
      throw new ToolError("syntax", parsed.message, undefined, { messageRef: parsed.messageRef });
    }

    columnCount = parsed.rows[0]?.length ?? 0;
    if (parsed.rows.some((row) => row.length !== columnCount)) {
      throw new ToolError(
        "shape",
        "Every CSV row must have the same number of fields.",
        "Check the delimiter, quotes, and field counts, then try again.",
        {
          messageRef: { key: "csv.errors.rowWidth" },
          recoveryMessage: { key: "csv.recovery.structure" },
        },
      );
    }

    const rows = parsed.rows
      .map((row) => row.map(normalizeCell))
      .filter((row) => !ctx.settings.trimWhitespace || row.some((value) => value !== ""));
    output = JSON.stringify(rows, null, 2);
    rowCount = rows.length;
  }

  for (const row of JSON.parse(output) as JsonRow[]) {
    if (!preview.addRow(row)) break;
  }
  return {
    render: "text",
    text: output,
    jsonPreview: preview.result(),
    downloadName: "data.json",
    stats: [
      { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(rowCount) },
      { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(columnCount) },
    ],
  };
};

export default run;
