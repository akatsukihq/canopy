import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { CSV_PREVIEW_BYTES, CSV_PREVIEW_ROWS } from "../../lib/tool-framework/limits.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityTable, tableToHtml, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { escapeHtml } from "../../lib/devtools/shared/text.ts";
import { createTextArtifactSink, isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";

type Settings = {
  readonly delimiter: string;
};

const MAX_PREVIEW_CELLS = 10_000;

function createTablePreview(columns: readonly string[]) {
  const encoder = new TextEncoder();
  const rowLimit = Math.min(CSV_PREVIEW_ROWS, Math.max(1, Math.floor(MAX_PREVIEW_CELLS / columns.length)));
  let remainingBytes =
    CSV_PREVIEW_BYTES - columns.reduce((size, column) => size + encoder.encode(column).byteLength, 0);
  const rows: (readonly string[])[] = [];
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
    append(row: readonly string[]) {
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

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  if (isLargeCsvRun(ctx)) {
    const sink = createTextArtifactSink(ctx, {
      mime: "text/html",
      name: "table.html",
    });
    let preview: ReturnType<typeof createTablePreview> | undefined;
    try {
      await sink.write("<table><thead>");
      const parsed = await parseCsvRun(ctx, {
        delimiter,
        onRow: async (row, rowNumber) => {
          const tag = rowNumber === 1 ? "th" : "td";
          const cells = row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("");
          if (rowNumber === 1) {
            preview = createTablePreview(row);
            await sink.write(`<tr>${cells}</tr></thead><tbody>`);
          } else {
            preview?.append(row);
            await sink.write(`<tr>${cells}</tr>`);
          }
        },
        previewRows: 0,
      });
      if (parsed.rowCount === 0)
        throw new ToolError("empty-table", "Delimited input has no rows.", undefined, {
          messageRef: { key: "csv.errors.emptyTable" },
        });
      await sink.write("</tbody></table>");
      const artifact = await sink.finish();
      return {
        render: "code",
        code: sink.preview,
        language: "html",
        truncated: sink.previewTruncated,
        tablePreview: preview?.result,
        stats: [
          { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(Math.max(0, parsed.rowCount - 1)) },
          { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(parsed.columnCount) },
        ],
        sections: [
          {
            title: sink.previewTruncated ? "Complete HTML table" : "Download",
            titleMessage: { key: sink.previewTruncated ? "csv.completeHtmlTable" : "csv.download" },
            body: { render: "files", files: [artifact], outputBytes: artifact.size },
          },
        ],
      };
    } catch (error) {
      await sink.abort(error);
      throw error;
    }
  }
  const rows = parseUtilityTable(ctx.input.text, delimiter);
  const preview = createTablePreview(rows[0]);
  for (let index = 1; index < rows.length; index += 1) preview.append(rows[index]);
  return {
    render: "html",
    html: tableToHtml(rows),
    downloadName: "table.html",
    tablePreview: preview.result,
  };
};

export default run;
