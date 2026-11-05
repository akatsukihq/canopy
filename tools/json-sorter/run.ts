/**
 * Moved verbatim from the `json-sorter` case and `sortJsonKeys` in
 * `lib/devtools/format-json.ts`. `sortJsonKeys` has one consumer, so it stays
 * in this folder.
 */

import { isRecord } from "../../lib/devtools/shared/json.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly repairMode: string;
  readonly indent: string;
};

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortJsonKeys(value[key])]),
  );
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const indentation = ctx.settings.indent === "4" ? 4 : 2;
  const value = parseUtilityJson(ctx.input.text, { repairMode: ctx.settings.repairMode });
  return {
    render: "code",
    code: JSON.stringify(sortJsonKeys(value), null, indentation),
    language: "json",
    downloadName: "sorted.json",
  };
};

export default run;
