/**
 * Preserves the original UTM generator's URL guard, merge/replace behavior,
 * normalization, and required fields while supporting additional parameters.
 */

import { safeUrl } from "../../lib/devtools/shared/url.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolErrorDetails, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { SettingRow } from "../../lib/tool-framework/settings.ts";
import { getParameterErrors } from "./parameters.ts";

type Settings = {
  readonly url: string;
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
  readonly term: string;
  readonly content: string;
  readonly parameters: readonly SettingRow[];
  readonly normalization: string;
  readonly existingQuery: string;
};

const PARAMETERS = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_term", "term"],
  ["utm_content", "content"],
] as const;

const REQUIRED = ["utm_source", "utm_medium", "utm_campaign"] as const;

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const url = safeUrl(ctx.settings.url, "Destination URL");
  if (ctx.settings.existingQuery === "replace") {
    url.search = "";
  }
  const normalizeValue = (value: string) =>
    ctx.settings.normalization === "lowercase" ? value.trim().toLowerCase() : value.trim();

  for (const [key, settingKey] of PARAMETERS) {
    const value = normalizeValue(ctx.settings[settingKey]);
    if (value) url.searchParams.set(key, value);
  }
  for (const required of REQUIRED) {
    if (!url.searchParams.get(required)) {
      throw new ToolError(
        "parameter-required",
        `${required} is required.`,
        "Fill in campaign source, medium, and name — a partially tagged link reports as direct traffic.",
        {
          messageRef: { key: "errors.parameter-required", values: { parameter: required } },
          recoveryMessage: { key: "recovery.parameter-required" },
        },
      );
    }
  }

  const extraRows = ctx.settings.parameters ?? [];
  let parameterMessage: ToolErrorDetails["messageRef"];
  const parameterError = getParameterErrors(extraRows, (issue) => {
    parameterMessage ??= {
      key: `errors.extra-${issue.code}`,
      ...(issue.code === "standard" ? { values: { parameter: issue.key } } : {}),
    };
    return undefined;
  }).find((error) => error !== "");
  if (parameterError) {
    throw new ToolError(
      "invalid-extra-parameter",
      parameterError,
      "Edit or remove the extra parameter row, then build the URL again.",
      { messageRef: parameterMessage, recoveryMessage: { key: "recovery.invalid-extra-parameter" } },
    );
  }
  for (const row of extraRows) {
    const key = row.key.trim();
    if (key) url.searchParams.set(key, normalizeValue(row.value));
  }

  return { render: "text", text: url.toString(), downloadName: "campaign-url.txt" };
};

export default run;
