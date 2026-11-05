/**
 * Moved verbatim from the `html-decoder` case and `decodeHtmlEntities` in
 * `lib/devtools/format-json.ts`. One consumer, so it stays in this folder.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const point = Number.parseInt(body.slice(2), 16);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    if (body.startsWith("#")) {
      const point = Number.parseInt(body.slice(1), 10);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return NAMED[body.toLowerCase()] ?? entity;
  });
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: decodeHtmlEntities(ctx.input.text),
});

export default run;
