import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { tokenizeJavaScript } from "../../lib/devtools/shared/code.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

function stripCodeCommentsAndWhitespace(input: string): string {
  let output = "";
  let previous: ReturnType<typeof tokenizeJavaScript>[number] | undefined;
  for (const token of tokenizeJavaScript(input, true)) {
    if (token.name === "LineComment" || token.name === "BlockComment") continue;
    if (previous && token.from > previous.to) {
      const gap = input.slice(previous.to, token.from);
      const last = previous.text.at(-1)!;
      const first = token.text[0];
      // Keep potential automatic-semicolon-insertion boundaries. A semicolon
      // or opening block has already made the original line break redundant.
      if (/[\n\r\u2028\u2029]/.test(gap) && previous.text !== ";" && previous.text !== "{") output += "\n";
      else {
        const punctuation = /[{}()[\],;:+*%=<>?]/;
        const operator = /[+\-*%=&|!?<>/]/;
        const wouldJoinOperators = operator.test(last) && operator.test(first);
        if (wouldJoinOperators || (!punctuation.test(last) && !punctuation.test(first))) output += " ";
      }
    }
    output += token.text;
    previous = token;
  }
  return output;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: stripCodeCommentsAndWhitespace(requireUtilityInput(ctx.input.text, "JavaScript input")),
  downloadName: "minified.js",
});

export default run;
