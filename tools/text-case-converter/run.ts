/**
 * Moved verbatim from the `text-case-converter` case and `convertTextCase` in
 * `lib/devtools/format-json.ts`. `convertTextCase` has one consumer, so it
 * lives here; the `words` splitter it builds on is shared and imported.
 */

import { words } from "../../lib/devtools/shared/text.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly target: string;
};

function convertTextCase(value: string, target: string): string {
  // Use locale-independent casing so recipients of a shared link get identical text.
  const parts = words(value);
  const lower = parts.map((part) => part.toLowerCase());
  const capitalize = (part: string) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part);

  switch (target) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "title":
      return parts.map(capitalize).join(" ");
    case "sentence":
      return lower.length ? capitalize(lower.join(" ")) : "";
    case "camel":
      return lower.map((part, index) => (index ? capitalize(part) : part)).join("");
    case "pascal":
      return lower.map(capitalize).join("");
    case "snake":
      return lower.join("_");
    case "kebab":
      return lower.join("-");
    case "constant":
      return lower.join("_").toUpperCase();
    default:
      throw new ToolError("unknown-case", "Choose a valid text case.", undefined, {
        messageRef: { key: "errors.unknown-case" },
      });
  }
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: convertTextCase(ctx.input.text, ctx.settings.target),
});

export default run;
