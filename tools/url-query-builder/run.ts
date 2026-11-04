/**
 * Build a URL from the shared bulk-row parser followed by editable setting
 * rows. URL handling and the row-format error string preserve the original
 * `url-query-builder` behavior from `lib/devtools/format-json.ts`.
 *
 * `safeUrl` returns a fresh `URL`, so mutating its `searchParams` does not
 * touch the caller's input.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import type { SettingRow } from "../../lib/tool-framework/settings.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { safeUrl } from "../../lib/devtools/shared/url.ts";
import { parseQueryRows } from "./parameters.ts";

type Settings = {
  readonly parameters: readonly SettingRow[];
  readonly encodeValues: boolean;
  readonly skipEmptyRows: boolean;
  readonly sortParameters: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const url = safeUrl(requireUtilityInput(ctx.input.text, "Base URL"), "Base URL");
  const rows = parseQueryRows(ctx.input.secondary ?? "");
  for (const row of ctx.settings.parameters ?? []) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key) {
      if (!value) continue;
      throw new ToolError(
        "invalid-query-row",
        "Each query row must use key=value format.",
        "Give every non-blank line a key, an equals sign, and a value.",
        { messageRef: { key: "errors.invalid-query-row" }, recoveryMessage: { key: "recovery.invalid-query-row" } },
      );
    }
    rows.push({ key, value });
  }

  const appended = ctx.settings.skipEmptyRows ? rows.filter((row) => row.value !== "") : rows;
  let text: string;
  if (ctx.settings.encodeValues !== false) {
    for (const row of appended) url.searchParams.append(row.key, row.value);
    if (ctx.settings.sortParameters) url.searchParams.sort();
    text = url.toString();
  } else {
    const hash = url.hash;
    url.hash = "";
    const entries = [
      ...Array.from(url.searchParams, ([key, value]) => ({
        key,
        text: new URLSearchParams([[key, value]]).toString(),
      })),
      ...appended.map(({ key, value }) => ({
        key,
        text: `${new URLSearchParams([[key, ""]]).toString()}${value}`,
      })),
    ];
    if (ctx.settings.sortParameters) {
      entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    }
    url.search = "";
    text = `${url.toString()}${entries.length ? `?${entries.map((entry) => entry.text).join("&")}` : ""}${hash}`;
  }
  return { render: "text", text, downloadName: "built-url.txt" };
};

export default run;
