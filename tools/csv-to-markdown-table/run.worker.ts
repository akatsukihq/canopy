/**
 * Moved verbatim from the `csv-to-markdown-table` case in
 * `lib/devtools/format-json.ts` (line 2203). Parsing and delimiter validation
 * are the shared `table.ts` helpers; only the Markdown cell escaping is local,
 * and it is byte-for-byte the original.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { createTextArtifactSink, isLargeCsvRun, parseCsvRun } from "../../lib/devtools/shared/streaming-csv-tool.ts";

type Settings = {
  readonly delimiter: string;
};

const markdownCell = (cell: string): string =>
  cell.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  if (isLargeCsvRun(ctx)) {
    const sink = createTextArtifactSink(ctx, {
      mime: "text/markdown",
      name: "table.md",
    });
    try {
      const parsed = await parseCsvRun(ctx, {
        delimiter,
        onRow: async (row, rowNumber) => {
          const line = `| ${row.map(markdownCell).join(" | ")} |`;
          if (rowNumber === 1) {
            await sink.write(`${line}\n| ${row.map(() => "---").join(" | ")} |`);
          } else {
            await sink.write(`\n${line}`);
          }
        },
        previewRows: 0,
      });
      const artifact = await sink.finish();
      return {
        render: "code",
        code: sink.preview,
        language: "markdown",
        truncated: sink.previewTruncated,
        stats: [
          { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(Math.max(0, parsed.rowCount - 1)) },
          { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(parsed.columnCount) },
        ],
        sections: [
          {
            title: sink.previewTruncated ? "Complete Markdown table" : "Download",
            titleMessage: { key: sink.previewTruncated ? "csv.completeMarkdownTable" : "csv.download" },
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
  return {
    render: "text",
    text: [
      `| ${rows[0].map(markdownCell).join(" | ")} |`,
      `| ${rows[0].map(() => "---").join(" | ")} |`,
      ...rows.slice(1).map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
    ].join("\n"),
    downloadName: "table.md",
  };
};

export default run;
