import { getRuntimeLimits } from "../../tool-framework/limits.ts";

const MAX_PREVIEW_CELLS = 10_000;

export function createTablePreview(columns: readonly string[], initialRows: Iterable<readonly string[]> = []) {
  const encoder = new TextEncoder();
  const { csvPreviewBytes, csvPreviewRows } = getRuntimeLimits();
  const rowLimit = Math.min(csvPreviewRows, Math.max(1, Math.floor(MAX_PREVIEW_CELLS / columns.length)));
  let remainingBytes =
    csvPreviewBytes - columns.reduce((size, column) => size + encoder.encode(column).byteLength, 0);
  const rows: (readonly string[])[] = [];
  const result =
    columns.length > MAX_PREVIEW_CELLS || remainingBytes < 0
      ? undefined
      : {
          render: "table" as const,
          columns,
          rows,
          showColumnDividers: true,
          truncated: false,
        };

  function append(row: readonly string[]) {
    if (!result || result.truncated) return;
    const rowBytes = row.reduce((size, cell) => size + encoder.encode(cell).byteLength, 0);
    if (rows.length >= rowLimit || rowBytes > remainingBytes) {
      result.truncated = true;
      return;
    }
    rows.push(row);
    remainingBytes -= rowBytes;
  }

  for (const row of initialRows) append(row);
  return { result, append };
}
