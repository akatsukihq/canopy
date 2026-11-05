/**
 * Moved verbatim from the `json-key-extractor` case in
 * `lib/devtools/format-json.ts`, together with its `collectJsonKeys` helper —
 * this tool is that helper's only consumer, so it lives here rather than in
 * `lib/devtools/shared/`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";

type Settings = {
  readonly repairMode: string;
};

function collectJsonKeys(value: unknown, path = "", keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonKeys(item, path ? `${path}[]` : "[]", keys));
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!keys.includes(childPath)) keys.push(childPath);
      collectJsonKeys(child, childPath, keys);
    }
  }
  return keys;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return {
    render: "text",
    text: collectJsonKeys(value).join("\n"),
    downloadName: "json-keys.txt",
  };
};

export default run;
