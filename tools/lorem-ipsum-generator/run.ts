/**
 * Moved verbatim from the `lorem-ipsum-generator` case in
 * `lib/devtools/format-json.ts`, together with its `LOREM_SENTENCES` pool —
 * this tool is that constant's only consumer, so it lives here rather than in
 * `lib/devtools/shared/`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly paragraphs: number;
  readonly startWithLorem: boolean;
  readonly paragraphLength: string;
  readonly customSentences: number;
  readonly includePunctuation: boolean;
};

const LOREM_SENTENCES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Integer feugiat nibh sed velit luctus, vitae facilisis justo luctus.",
  "Praesent commodo sem at augue posuere, non suscipit ipsum viverra.",
  "Donec vitae lectus sed neque efficitur consequat.",
];

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const sentenceCount =
    ctx.settings.paragraphLength === "custom"
      ? Math.trunc(ctx.settings.customSentences)
      : ctx.settings.paragraphLength === "short"
        ? 2
        : ctx.settings.paragraphLength === "long"
          ? 4
          : 3;
  const text = Array.from({ length: ctx.settings.paragraphs }, (_, index) =>
    Array.from(
      { length: sentenceCount },
      (__, offset) =>
        LOREM_SENTENCES[(index + offset + (ctx.settings.startWithLorem ? 0 : 1)) % LOREM_SENTENCES.length],
    ).join(" "),
  ).join("\n\n");
  return {
    render: "text",
    text: ctx.settings.includePunctuation ? text : text.replace(/[,.]/g, ""),
    downloadName: "lorem-ipsum.txt",
  };
};

export default run;
