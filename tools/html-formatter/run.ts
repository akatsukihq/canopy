import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly indentWidth: string;
  readonly printWidth: string;
  readonly attributeWrapping: string;
};

function formatHtml(input: string, settings: Settings): string {
  requireUtilityInput(input, "HTML input");
  const indentUnit = settings.indentWidth === "4" ? "    " : settings.indentWidth === "tab" ? "\t" : "  ";
  const printWidth =
    settings.printWidth === "unlimited" || !settings.printWidth ? Infinity : Number(settings.printWidth);
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  // Quoted attributes may contain angle brackets. Raw-text and whitespace-
  // sensitive elements are opaque, so formatting cannot alter their contents.
  const tokens =
    input.match(
      /<!--[\s\S]*?-->|<(script|style|pre|textarea)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<![^>]*>|<\/?[A-Za-z](?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+|</gi,
    ) ?? [];
  const lines: string[] = [];
  let indent = 0;
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (/^<(script|style|pre|textarea)\b/i.test(token) && /<\/[^>]+>$/.test(token)) {
      lines.push(`${indentUnit.repeat(indent)}${token}`);
      continue;
    }
    const closing = /^<\//.test(token);
    if (closing) indent = Math.max(0, indent - 1);
    const leading = indentUnit.repeat(indent);
    const startTag = token.match(/^<([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/);
    const attributes = startTag?.[2].match(/[^\s"'=<>`]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g) ?? [];
    const wrapAttributes =
      attributes.length > 0 &&
      (settings.attributeWrapping === "one-per-line" ||
        ((settings.attributeWrapping === "auto" || !settings.attributeWrapping) &&
          leading.length + token.length > printWidth));
    if (startTag && wrapAttributes) {
      lines.push(
        `${leading}<${startTag[1]}`,
        ...attributes.map((attribute) => `${leading}${indentUnit}${attribute}`),
        `${leading}${startTag[3] ? "/>" : ">"}`,
      );
    } else {
      lines.push(`${leading}${token}`);
    }
    const tag = token.match(/^<([A-Za-z][\w:-]*)/)?.[1].toLowerCase();
    if (tag && !closing && !token.endsWith("/>") && !voidTags.has(tag) && !token.includes(`</${tag}>`)) {
      indent += 1;
    }
  }
  return lines.join("\n");
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: formatHtml(ctx.input.text, ctx.settings),
  downloadName: "formatted.html",
});

export default run;
