/**
 * Moved verbatim from the `character-counter` case in
 * `lib/devtools/format-json.ts` (line 2307). `textMetrics` is the shared helper
 * and is called with no options, exactly as before; the label order and wording
 * of the five lines are unchanged.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { textMetrics } from "../../lib/devtools/shared/text.ts";

type Settings = {
  readonly includeSpaces: boolean;
  readonly limit280: boolean;
  readonly countLineBreaks: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const metrics = textMetrics(ctx.input.text);
  const { includeSpaces = true, limit280 = false, countLineBreaks = true } = ctx.settings;
  const withoutExcludedLineBreaks = countLineBreaks ? ctx.input.text : ctx.input.text.replace(/\r\n|\r|\n/gu, "");
  const countedCharacters = Array.from(
    includeSpaces ? withoutExcludedLineBreaks : withoutExcludedLineBreaks.replace(/[^\S\r\n]/gu, ""),
  ).length;
  const lines = [
    `Characters: ${limit280 ? `${countedCharacters} / 280` : countedCharacters}`,
    ...(limit280 ? [`Remaining: ${280 - countedCharacters}`] : []),
    `Characters without spaces: ${metrics.charactersWithoutSpaces}`,
    `Words: ${metrics.words}`,
    `Lines: ${metrics.lines}`,
    `UTF-8 bytes: ${metrics.bytes}`,
  ];
  return {
    render: "text",
    text: lines.join("\n"),
    tablePreview: {
      render: "table",
      columns: ["Metric", "Count"],
      columnMessages: [{ key: "execution.metric" }, { key: "execution.count" }],
      rows: [
        ["Characters", limit280 ? `${countedCharacters} / 280` : String(countedCharacters)],
        ...(limit280 ? [["Remaining", String(280 - countedCharacters)]] : []),
        ["Characters without spaces", String(metrics.charactersWithoutSpaces)],
        ["Words", String(metrics.words)],
        ["Lines", String(metrics.lines)],
        ["UTF-8 bytes", String(metrics.bytes)],
      ],
      rowMessages: ["characters", ...(limit280 ? ["remaining"] : []), "withoutSpaces", "words", "lines", "bytes"].map(
        (key) => [{ key: `execution.${key}` }, undefined],
      ),
    },
  };
};

export default run;
