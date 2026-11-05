/**
 * Moved verbatim from the `json-schema-generator` case in
 * `lib/devtools/format-json.ts` (line 2144) plus its single-consumer helper
 * `inferJsonSchema` (line 3269). The helper lives here rather than in
 * `lib/devtools/shared/` because this is the only tool that calls it.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";

type Settings = {
  readonly repairMode: string;
};

function inferJsonSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const schemas = value.map(inferJsonSchema);
    const unique = [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()];
    return { type: "array", items: unique.length === 0 ? {} : unique.length === 1 ? unique[0] : { anyOf: unique } };
  }
  if (isRecord(value)) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inferJsonSchema(child)])),
      required: Object.keys(value),
      additionalProperties: false,
    };
  }
  return {
    type: typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value,
  };
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return {
    render: "code",
    language: "json",
    code: JSON.stringify(inferJsonSchema(value), null, 2),
    downloadName: "schema.json",
  };
};

export default run;
