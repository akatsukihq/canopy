import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { protectCssStrings } from "../../lib/devtools/shared/code.ts";

type Settings = {
  readonly browserCompatibility: string;
  readonly mergeRules: boolean;
  readonly normalizeColors: boolean;
};

function normalizeHexColors(css: string): string {
  return css.replace(/([:\s,(])#([\da-f]{6}|[\da-f]{8})(?![\da-f])/gi, (match, prefix: string, hex: string) => {
    const pairs = hex.match(/../g);
    if (!pairs?.every((pair) => pair[0].toLowerCase() === pair[1].toLowerCase())) {
      return match;
    }
    return `${prefix}#${pairs.map((pair) => pair[0]).join("")}`;
  });
}

function convertAlphaHex(css: string): string {
  return css.replace(/([:\s,(])#([\da-f]{4}|[\da-f]{8})(?![\da-f])/gi, (_match, prefix: string, hex: string) => {
    const expanded = hex.length === 4 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex;
    const [red, green, blue, alpha] = expanded.match(/../g)!.map((pair) => parseInt(pair, 16));
    return `${prefix}rgba(${red},${green},${blue},${Number((alpha / 255).toFixed(3))})`;
  });
}

function mergeAdjacentRules(css: string): string {
  const matches = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  if (!matches.length || matches.map((match) => match[0]).join("") !== css) return css;
  const merged: { selectors: string[]; body: string }[] = [];
  for (const match of matches) {
    const selector = match[1];
    const body = match[2];
    const previous = merged.at(-1);
    if (previous?.body === body) previous.selectors.push(selector);
    else merged.push({ selectors: [selector], body });
  }
  return merged.map(({ selectors, body }) => `${selectors.join(",")}{${body}}`).join("");
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const protectedSource = protectCssStrings(requireUtilityInput(ctx.input.text, "CSS input"));
  const source = protectedSource.source.replace(/\s+/g, " ");
  let position = 0;
  let parentheses = 0;
  let text = source
    .replace(/\s*([{}:;,>+~])\s*/g, (match, punctuation: string, offset: number) => {
      while (position < offset) {
        if (source[position] === "(") parentheses += 1;
        else if (source[position] === ")") parentheses = Math.max(0, parentheses - 1);
        position += 1;
      }
      // CSS math requires whitespace around binary +. Selector combinators
      // outside functions can still be compacted safely.
      return punctuation === "+" && parentheses > 0 ? match : punctuation;
    })
    .replace(/;}/g, "}")
    .trim();
  if (ctx.settings.normalizeColors ?? false) text = normalizeHexColors(text);
  if (ctx.settings.browserCompatibility === "legacy") text = convertAlphaHex(text);
  if (ctx.settings.mergeRules ?? false) text = mergeAdjacentRules(text);
  return { render: "text", text: protectedSource.restore(text), downloadName: "minified.css" };
};

export default run;
