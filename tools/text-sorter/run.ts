/**
 * Uses English collation so shared inputs keep their ordering when opened
 * in a browser with a different default locale.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly order: string;
  readonly ci: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const sensitivity = ctx.settings.ci ? "base" : "variant";
  const direction = ctx.settings.order === "desc" ? -1 : 1;
  return {
    render: "text",
    text: ctx.input.text
      .split(/\r\n|\r|\n/)
      .sort((left, right) => left.localeCompare(right, "en", { sensitivity }) * direction)
      .join("\n"),
    downloadName: "sorted-text.txt",
  };
};

export default run;
