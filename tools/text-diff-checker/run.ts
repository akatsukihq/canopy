import { diffLines } from "../../lib/devtools/shared/line-diff.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {};

const LINE_MARKERS = { context: "  ", removed: "- ", added: "+ " } as const;

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const lines = diffLines(ctx.input.text, ctx.input.secondary ?? "");
  const added = lines.filter(({ kind }) => kind === "added").length;
  const removed = lines.filter(({ kind }) => kind === "removed").length;
  return {
    render: "text",
    text: lines.map(({ kind, text }) => `${LINE_MARKERS[kind]}${text}`).join("\n"),
    downloadName: "text-diff.txt",
    diffPreview: {
      render: "diff",
      lines,
      leftLabel: "Original text",
      leftLabelMessage: { key: "textDiff.original" },
      rightLabel: "Changed text",
      rightLabelMessage: { key: "textDiff.changedText" },
    },
    verdict: {
      level: "ok",
      label:
        added || removed
          ? `${added} ${added === 1 ? "line" : "lines"} added · ${removed} ${removed === 1 ? "line" : "lines"} removed`
          : "No differences",
      labelMessage:
        added || removed ? { key: "textDiff.changed", values: { added, removed } } : { key: "textDiff.identical" },
      detail: "Comparing changed text against original text. Whitespace is significant; line endings are normalized.",
      detailMessage: { key: "textDiff.comparison" },
    },
  };
};

export default run;
