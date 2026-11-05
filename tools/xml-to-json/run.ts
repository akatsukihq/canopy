/**
 * Moved verbatim from the `xml-to-json` case and `xmlToJson` in
 * `lib/devtools/format-json.ts`. `xmlToJson` and `SimpleXmlNode` have exactly
 * one consumer — this tool — so they live here rather than in
 * `lib/devtools/shared/`.
 */

import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

type SimpleXmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: SimpleXmlNode[];
  text: string;
};

function decodeXmlText(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&([^;\s]+);/g, (_match, reference: string) => {
    if (Object.hasOwn(entities, reference)) return entities[reference];
    const numeric = /^#(?:x([\da-fA-F]+)|(\d+))$/.exec(reference);
    const point = numeric ? Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10) : NaN;
    if (
      point === 0x9 ||
      point === 0xa ||
      point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff)
    )
      return String.fromCodePoint(point);
    throw new ToolError(
      "xml-invalid-entity",
      "XML contains an unsupported entity or invalid character reference.",
      undefined,
      { messageRef: { key: "errors.xml-invalid-entity" } },
    );
  });
}

function xmlToJson(input: string): unknown {
  const tokens =
    input.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+/g) ?? [];
  const stack: SimpleXmlNode[] = [];
  let root: SimpleXmlNode | undefined;

  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) {
      if (stack.length) stack.at(-1)!.text += token.slice(9, -3);
      continue;
    }
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      const closed = stack.pop();
      if (!closed || closed.name !== name) {
        throw new ToolError(
          "xml-unbalanced",
          "XML closing tags do not match.",
          "Check that every opening tag has a matching closing tag in the same order.",
          { messageRef: { key: "errors.xml-unbalanced" }, recoveryMessage: { key: "recovery.xml-unbalanced" } },
        );
      }
      continue;
    }
    if (token.startsWith("<")) {
      if (token.startsWith("<!")) continue;
      const selfClosing = /\/\s*>$/.test(token);
      const body = token.slice(1, selfClosing ? token.lastIndexOf("/") : -1).trim();
      const name = body.match(/^[^\s/>]+/)?.[0];
      if (!name)
        throw new ToolError("xml-invalid-tag", "XML contains an invalid tag.", undefined, {
          messageRef: { key: "errors.xml-invalid-tag" },
        });
      const attributes = Object.fromEntries(
        [...body.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
          match[1],
          decodeXmlText(match[2] ?? match[3] ?? ""),
        ]),
      );
      const node: SimpleXmlNode = { name, attributes, children: [], text: "" };
      if (stack.length) stack.at(-1)!.children.push(node);
      else if (root)
        throw new ToolError("xml-multiple-roots", "XML must have one root element.", undefined, {
          messageRef: { key: "errors.xml-multiple-roots" },
        });
      else root = node;
      if (!selfClosing) stack.push(node);
      continue;
    }
    if (stack.length) stack.at(-1)!.text += decodeXmlText(token);
  }
  if (!root || stack.length) {
    throw new ToolError(
      "xml-incomplete",
      "XML is incomplete or empty.",
      "Paste the whole document, including its closing root tag.",
      { messageRef: { key: "errors.xml-incomplete" }, recoveryMessage: { key: "recovery.xml-incomplete" } },
    );
  }

  function convert(node: SimpleXmlNode): unknown {
    const text = node.text.trim();
    if (!node.children.length && !Object.keys(node.attributes).length) return text;
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(node.attributes)) result[`@${key}`] = value;
    for (const child of node.children) {
      const childValue = convert(child);
      if (!Object.hasOwn(result, child.name)) result[child.name] = childValue;
      else if (Array.isArray(result[child.name])) (result[child.name] as unknown[]).push(childValue);
      else result[child.name] = [result[child.name], childValue];
    }
    if (text) result["#text"] = text;
    return result;
  }
  return { [root.name]: convert(root) };
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: JSON.stringify(xmlToJson(requireUtilityInput(ctx.input.text, "XML input")), null, 2),
  downloadName: "converted-xml.json",
});

export default run;
