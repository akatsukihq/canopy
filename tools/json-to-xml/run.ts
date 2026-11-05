/**
 * Adapted from the `json-to-xml` case in
 * `lib/devtools/format-json.ts` (line 2160) plus its single-consumer helper
 * `jsonToXml` (line 3315). Only this tool calls the helper, so it stays here
 * rather than in `lib/devtools/shared/`.
 *
 * `escapeHtml` escapes more than XML strictly requires (it also escapes quotes
 * and apostrophes). That is the pre-migration behaviour and is preserved: the
 * output is still valid XML, and widening it would be a behaviour change.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";
import { escapeHtml } from "../../lib/devtools/shared/text.ts";

type Settings = {
  readonly repairMode: string;
};

function jsonToXml(value: unknown, name = "root", depth = 0): string {
  const tag = /^[A-Za-z_][\w.-]*$/.test(name) ? name : "item";
  const indent = "  ".repeat(depth);
  if (value === null || value === undefined) return `${indent}<${tag}/>`;
  if (Array.isArray(value)) {
    if (depth === 0) {
      const children = value
        .map((item) => jsonToXml(item, "item", 1))
        .filter(Boolean)
        .join("\n");
      return children ? `<${tag}>\n${children}\n</${tag}>` : `<${tag}></${tag}>`;
    }
    return value
      .map((item) => jsonToXml(item, tag, depth))
      .filter(Boolean)
      .join("\n");
  }
  if (isRecord(value)) {
    const children = Object.entries(value)
      .map(([key, child]) => jsonToXml(child, key, depth + 1))
      .filter(Boolean)
      .join("\n");
    return children ? `${indent}<${tag}>\n${children}\n${indent}</${tag}>` : `${indent}<${tag}></${tag}>`;
  }
  return `${indent}<${tag}>${escapeHtml(value)}</${tag}>`;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return {
    render: "text",
    text: `<?xml version="1.0" encoding="UTF-8"?>\n${jsonToXml(value)}`,
    downloadName: "converted.xml",
  };
};

export default run;
