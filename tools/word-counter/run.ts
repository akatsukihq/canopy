/**
 * Moved verbatim from the `word-counter` case in
 * `lib/devtools/format-json.ts` (arm at line 2296). `textMetrics` is shared
 * (`lib/devtools/shared/text.ts`); the reading-time line and the exact label
 * order are the arm's own and are reproduced byte-for-byte.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { textMetrics } from "../../lib/devtools/shared/text.ts";

type Settings = {
  readonly countHyphenated: boolean;
  readonly ignoreNumbers: boolean;
  readonly excludeEmails: boolean;
  readonly estimateReadingTime: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const metrics = textMetrics(ctx.input.text, {
    countHyphenated: ctx.settings.countHyphenated,
    excludeEmails: ctx.settings.excludeEmails,
    ignoreNumbers: ctx.settings.ignoreNumbers,
  });
  const estimatedWords = Math.max(metrics.words, Math.ceil(metrics.charactersWithoutSpaces / 5));
  const readingSeconds = Math.ceil(estimatedWords * 0.3);
  const readingTime =
    estimatedWords < 200
      ? `${readingSeconds} second${readingSeconds === 1 ? "" : "s"}`
      : `${Math.ceil(estimatedWords / 200)} minute${estimatedWords > 200 ? "s" : ""}`;
  return {
    render: "text",
    text: `Words: ${metrics.words}\nCharacters: ${metrics.characters}\nCharacters without spaces: ${metrics.charactersWithoutSpaces}\nSentences: ${metrics.sentences}\nParagraphs: ${metrics.paragraphs}\nLines: ${metrics.lines}${ctx.settings.estimateReadingTime ? `\nReading time: ${readingTime}` : ""}`,
  };
};

export default run;
