import { completeAnyWord, snippetCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { renderInfo, type HoverInfo, type IntelligenceProvider, type SignatureInfo } from "./codeIntelligence";
import type { LanguageData, SymbolKind } from "./codeLanguageData";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** Position of the name in the declaration. */
  from: number;
  line: number;
  signature: string;
  params: string[];
  docs: string;
}

const MAX_INDEXED_LENGTH = 200_000;
const MAX_SYMBOLS = 5_000;
const NON_CODE = /comment|string|regexp/i;
/** Members reached through the current object still resolve to declarations in this file. */
const SELF = /^(?:(?:self|this|\$this|@)\.)?$/;
const KIND_LABEL: Record<SymbolKind, string> = {
  function: "function",
  class: "class",
  type: "type",
  variable: "variable",
  constant: "constant",
  namespace: "module",
};

/** Splits a parameter list on top-level commas, ignoring commas inside brackets and generics. */
export function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index++) {
    const char = list[index];
    if ("([{<".includes(char)) depth++;
    else if (")]}>".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function nameOf(piece: string, data: LanguageData): string | null {
  const cleaned = piece
    .replace(/\s*=.*$/s, "")
    .replace(/^.*\bas\s+/, "")
    .replace(/^(?:mut|ref|out|in|params|final|const|self\s*,)\s+/, "")
    .replace(/^[*&:]+/, "");
  const identifier = new RegExp(data.identifier.source, "g");
  const names = [...cleaned.replace(/<[^>]*>/g, "").matchAll(identifier)].map((match) => match[0]);
  const name = data.nameLast ? names.at(-1) : names[0];
  return name && !/^\d/.test(name) ? name.replace(/^:/, "") : null;
}

function documentationAbove(doc: Text, lineNumber: number, data: LanguageData): string {
  const lines: string[] = [];
  for (let number = lineNumber - 1; number >= 1 && lines.length < 30; number--) {
    const text = doc.line(number).text;
    if (/^\s*@/.test(text)) continue; // Annotations and decorators sit between docs and declaration.
    if (!data.docComment.test(text)) break;
    lines.unshift(
      text
        .replace(/^\s*(?:\/\*\*?|\*\/|\*|\/\/\/?|#+)\s?/, "")
        .replace(/\s*\*\/\s*$/, "")
        .trimEnd(),
    );
  }
  return lines.join("\n").trim();
}

function pythonDocstring(doc: Text, lineNumber: number): string {
  if (lineNumber >= doc.lines) return "";
  const first = doc.line(lineNumber + 1).text.trim();
  const quote = first.slice(0, 3);
  if (quote !== '"""' && quote !== "'''") return "";
  const lines = [first.slice(3)];
  for (let number = lineNumber + 1; number <= doc.lines && number < lineNumber + 40; number++) {
    const text = number === lineNumber + 1 ? lines[0] : doc.line(number).text.trim();
    if (number > lineNumber + 1) lines.push(text);
    if (text.includes(quote)) {
      lines[lines.length - 1] = text.slice(0, text.indexOf(quote));
      break;
    }
  }
  return lines.join("\n").trim();
}

const symbolCache = new WeakMap<Text, CodeSymbol[]>();

/** Declarations in the document, found by per-language patterns outside comments and strings. */
export function indexSymbols(state: EditorState, data: LanguageData): CodeSymbol[] {
  const cached = symbolCache.get(state.doc);
  if (cached) return cached;
  const doc = state.doc;
  const source = doc.length > MAX_INDEXED_LENGTH ? doc.sliceString(0, MAX_INDEXED_LENGTH) : doc.toString();
  const tree = ensureSyntaxTree(state, source.length, 50);
  const keywords = new Set(data.keywords.split(" "));
  const symbols: CodeSymbol[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: SymbolKind, from: number, params: string[] = []) => {
    const key = `${name}@${from}`;
    if (seen.has(key) || keywords.has(name) || symbols.length >= MAX_SYMBOLS) return;
    if (tree && NON_CODE.test(tree.resolveInner(from, 1).name)) return;
    seen.add(key);
    const line = doc.lineAt(from);
    const text = line.text.trim();
    // A one-line function keeps only its header: drop `{ body }` and Kotlin's `= expression` body.
    const header = kind === "function" ? text.replace(/\s*\{.*$/, "").replace(/(\)[^()=]*?)\s=\s.*$/, "$1") : text;
    const signature = header.replace(/\s*[{:]\s*$/, "").slice(0, 160);
    const docs = documentationAbove(doc, line.number, data);
    symbols.push({ name, kind, from, line: line.number, signature, params, docs });
  };

  for (const { kind, pattern, split } of data.declarations) {
    for (const match of source.matchAll(pattern)) {
      const group = match.groups?.name;
      if (!group || match.index === undefined) continue;
      const groupStart = match.index + match[0].indexOf(group);
      const params = match.groups?.params ? splitTopLevel(match.groups.params) : [];
      let offset = 0;
      for (const piece of group.split(split ?? /,/)) {
        const name = nameOf(piece, data);
        const at = name ? group.indexOf(name, offset) : -1;
        if (name && at >= 0) {
          add(name, kind, groupStart + at, kind === "function" ? params : []);
          offset = at + name.length;
        }
      }
      if (kind === "function" && match.groups?.params) {
        const paramsStart = match.index + match[0].lastIndexOf(match.groups.params);
        let cursor = 0;
        for (const param of params) {
          const name = nameOf(param, data);
          const at = name ? match.groups.params.indexOf(name, match.groups.params.indexOf(param, cursor)) : -1;
          cursor = match.groups.params.indexOf(param, cursor) + param.length;
          if (name && at >= 0 && name !== "self" && name !== "this") add(name, "variable", paramsStart + at);
        }
      }
    }
  }
  // Python documents functions and classes with a docstring under the declaration; it wins over comments.
  for (const symbol of symbols) {
    if (/^\s*(?:async\s+)?(?:def|class)\b/.test(doc.line(symbol.line).text)) {
      symbol.docs = pythonDocstring(doc, symbol.line) || symbol.docs;
    }
  }
  symbols.sort((a, b) => a.from - b.from);
  symbolCache.set(state.doc, symbols);
  return symbols;
}

/** The identifier under `pos`, with any `a.b.` / `a::b` qualifier in front of it. */
function wordAt(state: EditorState, pos: number, data: LanguageData) {
  const line = state.doc.lineAt(pos);
  const identifier = new RegExp(data.identifier.source, "g");
  for (const match of line.text.matchAll(identifier)) {
    const from = line.from + (match.index ?? 0);
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    const before = line.text.slice(0, from - line.from);
    const qualifier = before.match(/((?:[A-Za-z_$][\w$]*(?:\.|::|->))+)$/)?.[1] ?? "";
    return { from, to, name: match[0], qualifier: qualifier.replace(/->/g, ".") };
  }
  return null;
}

function definitionFor(symbols: CodeSymbol[], name: string, pos: number) {
  const bare = name.replace(/^\$/, "");
  const matches = symbols.filter((symbol) => symbol.name === name || symbol.name.replace(/^\$/, "") === bare);
  if (!matches.length) return null;
  // Nearest declaration above the use wins (shadowing); otherwise the first one (hoisted functions).
  return matches.filter((symbol) => symbol.from <= pos).at(-1) ?? matches[0];
}

function builtinFor(data: LanguageData, name: string, qualifier: string) {
  const qualified = `${qualifier}${name}`;
  for (const key of [qualified, qualified.replace(/^[^.:]+(?:\.|::)/, ""), name]) {
    const entry = data.builtins[key];
    if (entry) return { key, entry };
  }
  return null;
}

function signatureParts(signature: string) {
  const open = signature.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < signature.length; index++) {
    if (signature[index] === "(") depth++;
    else if (signature[index] === ")" && --depth === 0) {
      return {
        prefix: signature.slice(0, open + 1),
        params: splitTopLevel(signature.slice(open + 1, index)),
        suffix: signature.slice(index),
      };
    }
  }
  return null;
}

/** Finds the call whose argument list contains `pos`: callee text and active argument index. */
export function callAt(text: string): { callee: string; argument: number } | null {
  let depth = 0;
  let argument = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    const char = text[index];
    if (char === ")" || char === "]" || char === "}") depth++;
    else if (char === "[") depth = Math.max(0, depth - 1);
    else if (char === "{" || char === ";") {
      if (depth === 0) return null; // Reached the enclosing block or statement: not inside a call.
      if (char === "{") depth--;
    } else if (char === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const callee = text.slice(0, index).match(/((?:[A-Za-z_$][\w$]*(?:\.|::|->))*[A-Za-z_$][\w$]*)!?\s*$/)?.[1];
      return callee ? { callee, argument } : null;
    } else if (char === "," && depth === 0) argument++;
  }
  return null;
}

const KIND_TYPES: Record<SymbolKind, string> = {
  function: "function",
  class: "class",
  type: "type",
  variable: "variable",
  constant: "constant",
  namespace: "namespace",
};

/** Completion: in-file symbols, the language's keywords, documented built-ins and snippets. */
export function symbolCompletionSource(data: LanguageData): CompletionSource {
  const keywordOptions: Completion[] = data.keywords.split(" ").map((label) => ({ label, type: "keyword" }));
  const snippetOptions = data.snippets.map(([label, template, detail]) =>
    snippetCompletion(template, { label, detail, type: "snippet", boost: -10 }),
  );
  const builtinOption = (view: EditorView | undefined, label: string, signature: string, docs: string): Completion => ({
    label,
    type: /^(?:class|struct|enum|final class|static class|template)/.test(signature)
      ? "class"
      : /^(?:package|module|mod|namespace)\b/.test(signature)
        ? "namespace"
        : /\(/.test(signature)
          ? "function"
          : "variable",
    detail: "built-in",
    info: view ? () => renderInfo(view.state, signature, docs) : docs,
  });
  const word = new RegExp(`(?:(?:[A-Za-z_$][\\w$]*)(?:\\.|::|->))*(?:${data.identifier.source})?$`);

  return (context) => {
    const match = context.matchBefore(word);
    if (!match || (match.from === match.to && !context.explicit)) return null;
    const separator = /(?:\.|::|->)(?=[^.:>]*$)/.exec(match.text);
    if (separator) {
      const qualifier = match.text.slice(0, separator.index).replace(/->/g, ".");
      const sep = separator[0] === "->" ? "." : separator[0];
      const prefix = `${qualifier}${sep}`;
      const members = new Map<string, Completion>();
      for (const [key, [signature, docs]] of Object.entries(data.builtins)) {
        if (!key.startsWith(prefix)) continue;
        const label = key.slice(prefix.length).split(/\.|::/)[0];
        if (!members.has(label)) members.set(label, builtinOption(context.view, label, signature, docs));
      }
      if (!members.size) return null; // Unknown receivers fall back to document words.
      return {
        from: match.from + separator.index + separator[0].length,
        options: [...members.values()],
        validFor: /^[\w$]*$/,
      };
    }
    const symbols = indexSymbols(context.state, data);
    const local = new Map<string, Completion>();
    for (const symbol of symbols) {
      if (symbol.from === match.from || local.has(symbol.name)) continue;
      local.set(symbol.name, {
        label: symbol.name,
        type: KIND_TYPES[symbol.kind],
        detail: `line ${symbol.line}`,
        boost: 5,
        info: context.view
          ? () =>
              renderInfo(
                context.view!.state,
                symbol.signature,
                symbol.docs,
                `${KIND_LABEL[symbol.kind]} · line ${symbol.line}`,
              )
          : symbol.docs || undefined,
      });
    }
    const builtins = Object.entries(data.builtins)
      .filter(([key]) => !/\.|::/.test(key) && !local.has(key))
      .map(([key, [signature, docs]]) => builtinOption(context.view, key, signature, docs));
    return {
      from: match.from,
      options: [...local.values(), ...builtins, ...keywordOptions, ...snippetOptions],
      validFor: /^[\w$]*$/,
    };
  };
}

/** Other words in the document, minus anything the symbol source already offers with richer info. */
export function documentWordSource(data: LanguageData): CompletionSource {
  const known = new Set([
    ...data.keywords.split(" "),
    ...Object.keys(data.builtins).map((key) => key.split(/\.|::/).at(-1) ?? key),
  ]);
  return async (context) => {
    const result = await completeAnyWord(context);
    if (!result) return null;
    const symbols = new Set(indexSymbols(context.state, data).map((symbol) => symbol.name));
    const options = result.options.filter((option) => !known.has(option.label) && !symbols.has(option.label));
    return options.length ? { ...result, options } : null;
  };
}

/** In-file intelligence for languages without a bundled language service. */
export function createSymbolProvider(data: LanguageData): IntelligenceProvider {
  return {
    hover(view, pos): HoverInfo | null {
      const word = wordAt(view.state, pos, data);
      if (!word) return null;
      if (NON_CODE.test(ensureSyntaxTree(view.state, word.to, 20)?.resolveInner(word.from, 1).name ?? "")) return null;
      const builtin = builtinFor(data, word.name, word.qualifier);
      const symbol = SELF.test(word.qualifier)
        ? definitionFor(indexSymbols(view.state, data), word.name, word.from)
        : null;
      if (symbol) {
        const note =
          symbol.from === word.from
            ? `${KIND_LABEL[symbol.kind]} · declared here`
            : `${KIND_LABEL[symbol.kind]} · line ${symbol.line} · Ctrl/Cmd+click to go there`;
        return { from: word.from, to: word.to, signature: symbol.signature, docs: symbol.docs, note };
      }
      if (builtin)
        return { from: word.from, to: word.to, signature: builtin.entry[0], docs: builtin.entry[1], note: "built-in" };
      return null;
    },
    definition(view, pos) {
      const word = wordAt(view.state, pos, data);
      if (!word || !SELF.test(word.qualifier)) return null;
      return definitionFor(indexSymbols(view.state, data), word.name, word.from)?.from ?? null;
    },
    signature(view, pos): SignatureInfo | null {
      const call = callAt(view.state.doc.sliceString(Math.max(0, pos - 2_000), pos));
      if (!call) return null;
      const name = call.callee.match(/[\w$]+$/)?.[0] ?? "";
      const qualifier = call.callee.slice(0, -name.length).replace(/->/g, ".");
      const symbol = !SELF.test(qualifier) ? null : definitionFor(indexSymbols(view.state, data), name, pos);
      let signature: string | undefined;
      let docs: string | undefined;
      if (symbol?.kind === "function") {
        signature = symbol.signature;
        docs = symbol.docs;
      } else {
        const builtin = builtinFor(data, name, qualifier);
        if (builtin) [signature, docs] = builtin.entry;
      }
      const parts = signature ? signatureParts(signature) : null;
      if (!parts || !parts.params.length) return null;
      return {
        prefix: parts.prefix,
        params: parts.params.map((label) => ({ label })),
        separator: ", ",
        suffix: parts.suffix,
        docs,
        active: Math.min(call.argument, parts.params.length - 1),
      };
    },
  };
}
