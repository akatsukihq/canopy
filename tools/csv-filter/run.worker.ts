/**
 * Moved verbatim from the `csv-filter` case in `lib/devtools/format-json.ts`
 * (region: `executeUtilityTool`). Same delimiter resolution, same header
 * handling, same case-insensitive substring match, same column resolution by
 * name or 1-based index.
 */

import { parseUtilityTable, serializeTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import {
  createTextArtifactSink,
  isLargeCsvRun,
  parseCsvRun,
  serializeCsvRow,
} from "../../lib/devtools/shared/streaming-csv-tool.ts";

type Settings = {
  readonly delimiter: string;
  readonly query: string;
  readonly column: string;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  const query = ctx.settings.query.toLocaleLowerCase();
  if (!query) {
    throw new ToolError(
      "filter-required",
      "Filter text is required.",
      "Enter the text a row must contain to be kept.",
      {
        messageRef: { key: "csv.errors.filterRequired" },
        recoveryMessage: { key: "csv.recovery.filterRequired" },
      },
    );
  }
  const requested = ctx.settings.column.trim();
  if (isLargeCsvRun(ctx)) {
    const sink = createTextArtifactSink(ctx, {
      mime: "text/plain",
      name: "filtered-data.txt",
    });
    let column = -1;
    let kept = 0;
    let wrote = false;
    let preview: ReturnType<typeof createTablePreview> | undefined;
    try {
      const parsed = await parseCsvRun(ctx, {
        delimiter,
        onRow: async (row, rowNumber) => {
          if (rowNumber === 1) {
            preview = createTablePreview(row);
            column = requested ? (/^\d+$/.test(requested) ? Number(requested) - 1 : row.indexOf(requested)) : -1;
            if (requested && (column < 0 || column >= row.length)) {
              throw new ToolError(
                "column-not-found",
                "Filter column was not found.",
                "Use a header name from the first row, or a 1-based column number.",
                {
                  messageRef: { key: "csv.errors.filterColumnMissing" },
                  recoveryMessage: { key: "csv.recovery.filterColumn" },
                },
              );
            }
          }
          const keep =
            rowNumber === 1 ||
            (column >= 0 ? [row[column] ?? ""] : row).some((cell) => cell.toLocaleLowerCase().includes(query));
          if (!keep) return;
          if (rowNumber > 1) kept += 1;
          if (rowNumber > 1) preview?.append(row);
          await sink.write(`${wrote ? "\n" : ""}${serializeCsvRow(row, delimiter)}`);
          wrote = true;
        },
        previewRows: 0,
      });
      const artifact = await sink.finish();
      return {
        render: "code",
        code: sink.preview,
        language: "csv",
        truncated: sink.previewTruncated,
        tablePreview: preview?.result,
        stats: [
          { label: "Matched rows", labelMessage: { key: "csv.matchedRows" }, value: String(kept) },
          {
            label: "Scanned rows",
            labelMessage: { key: "csv.scannedRows" },
            value: String(Math.max(0, parsed.rowCount - 1)),
          },
        ],
        sections: [
          {
            title: sink.previewTruncated ? "Complete filtered file" : "Download",
            titleMessage: { key: sink.previewTruncated ? "csv.completeFilteredFile" : "csv.download" },
            body: { render: "files", files: [artifact], outputBytes: artifact.size },
          },
        ],
      };
    } catch (error) {
      await sink.abort(error);
      throw error;
    }
  }
  const [header, ...rows] = parseUtilityTable(ctx.input.text, delimiter);
  const column = requested ? (/^\d+$/.test(requested) ? Number(requested) - 1 : header.indexOf(requested)) : -1;
  if (requested && (column < 0 || column >= header.length)) {
    throw new ToolError(
      "column-not-found",
      "Filter column was not found.",
      "Use a header name from the first row, or a 1-based column number.",
      {
        messageRef: { key: "csv.errors.filterColumnMissing" },
        recoveryMessage: { key: "csv.recovery.filterColumn" },
      },
    );
  }
  const filtered = rows.filter((row) =>
    (column >= 0 ? [row[column]] : row).some((cell) => cell.toLocaleLowerCase().includes(query)),
  );

  return {
    render: "text",
    text: serializeTable([header, ...filtered], delimiter),
    tablePreview: createTablePreview(header, filtered).result,
    downloadName: "filtered-data.txt",
  };
};

export default run;
