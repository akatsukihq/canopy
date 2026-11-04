/**
 * Moved verbatim from the `csv-duplicate-remover` case in
 * `lib/devtools/format-json.ts` (arm at line 2240).
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityTable, serializeTable, utilityDelimiter } from "../../lib/devtools/shared/table.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";

type Settings = {
  readonly delimiter: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const delimiter = utilityDelimiter(ctx.settings.delimiter);
  const [header, ...rows] = parseUtilityTable(ctx.input.text, delimiter);
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    render: "text",
    text: serializeTable([header, ...unique], delimiter),
    tablePreview: createTablePreview(header, unique).result,
    downloadName: "deduplicated-data.txt",
  };
};

export default run;
