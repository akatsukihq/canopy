/**
 * Moved verbatim from the `json-to-typescript` case in
 * `lib/devtools/format-json.ts` (arm at line 2123), together with its two
 * single-consumer helpers `jsonToTypeScript` and `toPascalCase`
 * (format-json.ts:3213-3242). Nothing else consumes them, so they live here
 * rather than in `lib/devtools/shared/`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseUtilityJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";

type Settings = {
  readonly repairMode: string;
};

function toPascalCase(value: string): string {
  const words = value.replace(/([a-z\d])([A-Z])/g, "$1 $2").match(/[\p{L}\p{N}]+/gu) ?? [];
  const joined = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^\d/.test(joined) ? `Type${joined}` : joined || "Value";
}

function jsonToTypeScript(value: unknown): string {
  const interfaces: string[] = [];

  function infer(current: unknown, name: string): string {
    if (current === null) return "null";
    if (Array.isArray(current)) {
      const types = [...new Set(current.map((item) => infer(item, `${name}Item`)))];
      const itemType = types.length ? types.join(" | ") : "unknown";
      return `${types.length > 1 ? `(${itemType})` : itemType}[]`;
    }
    if (!isRecord(current)) return typeof current;

    const interfaceName = toPascalCase(name);
    const fields = Object.entries(current).map(([key, child]) => {
      const property = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      return `  ${property}: ${infer(child, key)};`;
    });
    interfaces.unshift(`export interface ${interfaceName} {\n${fields.join("\n")}\n}`);
    return interfaceName;
  }

  const rootType = infer(value, "Root");
  if (isRecord(value)) return interfaces.join("\n\n");
  return `${interfaces.join("\n\n")}${interfaces.length ? "\n\n" : ""}export type Root = ${rootType};`;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const value = parseUtilityJson(ctx.input.text, {
    repairMode: ctx.settings.repairMode,
  });
  return { render: "text", text: jsonToTypeScript(value), downloadName: "types.ts" };
};

export default run;
