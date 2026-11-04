import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { formatDelimitedCode, protectCssStrings } from "../../lib/devtools/shared/code.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly indentWidth: string;
  readonly printWidth: string;
  readonly propertyOrder: string;
};

function sortDeclarations(css: string): string {
  const lines = css.split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!/^\s+[-\w]+\s*:/.test(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const declarations: string[] = [];
    while (index < lines.length && /^\s+[-\w]+\s*:/.test(lines[index])) {
      declarations.push(lines[index]);
      index += 1;
    }
    const keepFinalSemicolon = declarations.at(-1)?.trimEnd().endsWith(";") ?? false;
    declarations
      .map((line) => line.replace(/;\s*$/, ""))
      .sort((left, right) =>
        left
          .slice(0, left.indexOf(":"))
          .trim()
          .localeCompare(right.slice(0, right.indexOf(":")).trim(), "en", { sensitivity: "base" }),
      )
      .forEach((line, declarationIndex, sorted) => {
        const semicolon = declarationIndex < sorted.length - 1 || keepFinalSemicolon ? ";" : "";
        output.push(`${line}${semicolon}`);
      });
  }
  return output.join("\n");
}

function wrapLines(css: string, width: number, indent: string): string {
  return css
    .split("\n")
    .flatMap((line) => {
      if (/["'`]/.test(line)) return [line];
      const lines: string[] = [];
      let remaining = line;
      const leading = /^\s*/.exec(line)?.[0] ?? "";
      const continuation = `${leading}${indent}`;
      if (
        line
          .trim()
          .split(/\s+/)
          .some((word) => word.length > width - continuation.length)
      )
        return [line];
      while (remaining.length > width) {
        const breakAt = remaining.lastIndexOf(" ", width);
        if (breakAt <= (remaining.match(/^\s*/)?.[0].length ?? 0)) break;
        lines.push(remaining.slice(0, breakAt));
        remaining = `${continuation}${remaining.slice(breakAt + 1).trimStart()}`;
      }
      return [...lines, remaining];
    })
    .join("\n");
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const indent = ctx.settings.indentWidth === "4" ? "    " : ctx.settings.indentWidth === "tab" ? "\t" : "  ";
  const protectedSource = protectCssStrings(requireUtilityInput(ctx.input.text, "CSS input"));
  let text = formatDelimitedCode(protectedSource.source, "css", indent);
  if (ctx.settings.propertyOrder === "alphabetical") text = sortDeclarations(text);
  if (ctx.settings.printWidth !== "unlimited") {
    text = wrapLines(text, Number(ctx.settings.printWidth), indent);
  }
  return { render: "text", text: protectedSource.restore(text), downloadName: "formatted.css" };
};

export default run;
