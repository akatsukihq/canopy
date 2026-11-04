import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { Tag } from "@lezer/highlight";

const loadedLanguages = new Map<string, Promise<Extension>>();

const YAML_KEYWORD = /^(?:true|True|TRUE|false|False|FALSE|null|Null|NULL|~)$/;
const YAML_NUMBER =
  /^(?:[+-]?(?:0b[01](?:_?[01])*|0o[0-7](?:_?[0-7])*|0x[\da-fA-F](?:_?[\da-fA-F])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|\.inf|\.Inf|\.INF)|\.nan|\.NaN|\.NAN)$/;
const YAML_TYPED_SCALAR = /^(?:!!(?:int|float|bool|null)|!<tag:yaml.org,2002:(?:int|float|bool|null)>)$/;

/** Classify only short visible native Literal nodes; parsing and folding stay native. */
export function collectYamlScalars(
  tree: Tree,
  visibleRanges: readonly { from: number; to: number }[],
  readText: (from: number, to: number) => string,
): { from: number; to: number }[] {
  const scalars: { from: number; to: number }[] = [];
  let visited = 0;
  for (const range of visibleRanges) {
    if (range.to <= range.from || range.from >= tree.length) continue;
    const cursor = tree.cursor();
    while (cursor.childAfter(range.from)) {
      if (++visited > 4_000) return scalars;
    }
    do {
      if (++visited > 4_000 || scalars.length >= 1_000) return scalars;
      if (cursor.from >= range.to) break;
      if (
        cursor.name !== "Literal" ||
        cursor.to <= range.from ||
        cursor.to - cursor.from > 128 ||
        cursor.from < (scalars.at(-1)?.to ?? -1)
      )
        continue;
      let excluded = false;
      for (let parent = cursor.node.parent, depth = 0; parent && depth < 8; parent = parent.parent, depth++) {
        if (parent.name === "Key") excluded = true;
        if (parent.name === "Tagged") {
          const tag = parent.getChild("Tag");
          if (!tag || tag.to - tag.from > 64 || !YAML_TYPED_SCALAR.test(readText(tag.from, tag.to))) excluded = true;
        }
        if (excluded || parent.name === "Pair" || parent.name === "Item") break;
      }
      if (excluded) continue;
      const text = readText(cursor.from, cursor.to).trim();
      if (YAML_KEYWORD.test(text) || YAML_NUMBER.test(text)) scalars.push({ from: cursor.from, to: cursor.to });
    } while (cursor.next());
  }
  return scalars;
}

const yamlScalarMark = Decoration.mark({ class: "cm-yaml-scalar" });
const yamlScalarHighlighting = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = this.highlight(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = this.highlight(update.view);
      }
    }
    highlight(view: EditorView) {
      const ranges = collectYamlScalars(syntaxTree(view.state), view.visibleRanges, (from, to) =>
        view.state.doc.sliceString(from, to),
      );
      return Decoration.set(ranges.map(({ from, to }) => yamlScalarMark.range(from, to)));
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// The stream-based (legacy) grammars never tag call sites, so mark `name(` where the token is a plain
// identifier. Strings, comments and keywords such as `if (` keep their own colour.
const CALLABLE_TOKEN = /variable|def|property|type|builtin|function/i;
const callMark = Decoration.mark({ class: "cm-call" });
const callTheme = EditorView.baseTheme({ ".cm-call": { color: "var(--syntax-bracket-3)" } });
const callHighlighting = [
  callTheme,
  ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = this.mark(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
          this.decorations = this.mark(update.view);
        }
      }
      mark(view: EditorView) {
        const tree = syntaxTree(view.state);
        const ranges = [];
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          for (const match of text.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
            if (ranges.length >= 2_000) break;
            const start = from + match.index;
            if (CALLABLE_TOKEN.test(tree.resolveInner(start, 1).name)) {
              ranges.push(callMark.range(start, start + match[1].length));
            }
          }
        }
        return Decoration.set(ranges);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
];

function createDelimitedLanguage(tabSeparated: boolean) {
  const delimiter = tabSeparated ? /^\t/ : /^[,;\t|]/;
  const unquoted = tabSeparated ? /^[^"\t]+/ : /^[^",;\t|]+/;
  return StreamLanguage.define({
    startState: () => ({ quoted: false }),
    token(stream, state) {
      if (state.quoted || stream.peek() === '"') {
        if (!state.quoted) {
          stream.next();
          state.quoted = true;
        }
        while (!stream.eol()) {
          if (stream.next() !== '"') continue;
          if (stream.peek() === '"') stream.next();
          else {
            state.quoted = false;
            break;
          }
        }
        return "string";
      }
      if (stream.match(delimiter)) return "punctuation";
      stream.match(unquoted);
      const cell = stream.current().trim();
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell)) return "number";
      if (/^(?:true|false|null)$/i.test(cell)) return "atom";
      return "string";
    },
  });
}

function createJwtLanguage(): Extension {
  const parts = ["jwtHeader", "jwtPayload", "jwtSignature"];
  const partTags = parts.map(() => Tag.define());
  return [
    StreamLanguage.define({
      name: "jwt",
      startState: () => ({ part: 0 }),
      tokenTable: Object.fromEntries(parts.map((part, index) => [part, partTags[index]])),
      token(stream, state) {
        if (stream.eatSpace()) return null;
        if (stream.eat(".")) {
          state.part = Math.min(state.part + 1, parts.length);
          return null;
        }
        if (stream.match(/^[A-Za-z0-9_-]+/)) return parts[state.part] ?? null;
        stream.next();
        return null;
      },
    }),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: partTags[0], color: "var(--syntax-bracket-3)" },
        { tag: partTags[1], color: "var(--syntax-bracket-2)" },
        { tag: partTags[2], color: "var(--syntax-string)" },
      ]),
    ),
  ];
}

function createUrlLanguage(): Extension {
  return StreamLanguage.define({
    name: "url",
    startState: () => ({ part: "start" }),
    token(stream, state) {
      if (stream.sol()) state.part = "start";
      if (stream.eatSpace()) return null;
      if (state.part === "start") {
        if (stream.match(/^[a-z][a-z\d+.-]*:/i)) {
          state.part = "scheme";
          return "keyword";
        }
        if (stream.match("//")) {
          state.part = "host";
          return "punctuation";
        }
        state.part = stream.peek() === "/" ? "path" : "key";
        if (stream.eat("?")) return "punctuation";
      }
      if (state.part === "scheme") {
        if (stream.match("//")) {
          state.part = "host";
          return "punctuation";
        }
        state.part = "path";
      }
      if (stream.match(/^%[\da-f]{2}/i)) return "atom";
      if (state.part === "fragment") {
        if (!stream.match(/^[^\s%]+/)) stream.next();
        return "string";
      }
      if (stream.eat("#")) {
        state.part = "fragment";
        return "punctuation";
      }
      if (state.part === "host" || state.part === "path") {
        if (stream.eat("?")) {
          state.part = "key";
          return "punctuation";
        }
        if (stream.eat("/")) {
          state.part = "path";
          return "punctuation";
        }
        if (!stream.match(/^[^\s/?#%]+/)) stream.next();
        return state.part === "host" ? "link" : "string";
      }
      if (stream.eat("&")) {
        state.part = "key";
        return "punctuation";
      }
      if (state.part === "key" && stream.eat("=")) {
        state.part = "value";
        return "punctuation";
      }
      if (!stream.match(state.part === "key" ? /^[^\s&=#%]+/ : /^[^\s&#%]+/)) stream.next();
      return state.part === "key" ? "keyword" : "string";
    },
  });
}

function createQrLanguage(): Extension {
  return StreamLanguage.define({
    name: "qr",
    startState: () => ({ mode: "plain", part: "", vcard: false }),
    token(stream, state) {
      if (stream.sol()) {
        const beginsVcard = /^\s*BEGIN:VCARD\s*$/i.test(stream.string);
        state.mode =
          state.vcard || beginsVcard
            ? "vcard"
            : /^\s*WIFI:/i.test(stream.string)
              ? "wifi"
              : /^\s*(?:[a-z][a-z\d+.-]*:\/\/|(?:https?|ftp|mailto|tel|sms|geo):)/i.test(stream.string)
                ? "url"
                : "plain";
        state.part = state.mode === "vcard" ? (state.vcard && /^\s/.test(stream.string) ? "value" : "key") : "prefix";
        if (beginsVcard) state.vcard = true;
        if (/^END:VCARD\s*$/i.test(stream.string)) state.vcard = false;
      }
      if (state.mode === "plain") {
        stream.skipToEnd();
        return null;
      }
      if (state.mode === "url") {
        if (stream.eatSpace()) {
          if (state.part !== "prefix") state.mode = "plain";
          return null;
        }
        if (state.part === "prefix" && stream.match(/^[a-z][a-z\d+.-]*:/i)) {
          state.part = "host";
          return "keyword";
        }
        if (state.part === "fragment" && stream.match(/^\S+/)) return "string";
        if (state.part === "host" && stream.match("//")) return "punctuation";
        if (stream.match(/^[/?&#=:]/)) {
          const separator = stream.current();
          if (separator === "/") state.part = "path";
          if (separator === "?" || separator === "&") state.part = "key";
          if (separator === "=") state.part = "value";
          if (separator === "#") state.part = "fragment";
          return "punctuation";
        }
        if (stream.match(/^[^\s/?&#=:]+/)) {
          return state.part === "host" ? "link" : state.part === "key" ? "keyword" : "string";
        }
      } else if (state.mode === "wifi") {
        if (state.part === "prefix") {
          if (stream.eatSpace()) return null;
          if (stream.match(/^WIFI:/i)) {
            state.part = "key";
            return "keyword";
          }
        }
        if (stream.eat(";")) {
          state.part = "key";
          return "punctuation";
        }
        if (state.part === "value") {
          if (!stream.match(/^(?:\\.|[^\\;])+/)) stream.next();
          return "string";
        }
        if (stream.eat(":")) {
          state.part = "value";
          return "punctuation";
        }
        if (stream.match(/^[a-z][a-z\d_-]*/i)) return "keyword";
      } else {
        if (state.part === "value") {
          stream.skipToEnd();
          return "string";
        }
        if (stream.eatSpace()) return null;
        if (stream.match(/^[;=:]/)) {
          state.part = stream.current() === ":" ? "value" : stream.current() === "=" ? "parameterValue" : "key";
          return "punctuation";
        }
        if (state.part === "parameterValue" && stream.match(/^(?:"(?:\\.|[^"\\])*"?|[^;:\s]+)/)) return "string";
        if (stream.match(/^[a-z\d.-]+/i)) return "keyword";
      }
      stream.next();
      return null;
    },
  });
}

async function importLanguage(language: string): Promise<Extension> {
  switch (language) {
    case "url":
      return createUrlLanguage();
    case "url-encoded":
      return StreamLanguage.define({
        name: "url-encoded",
        token(stream) {
          if (stream.match(/^%[\da-f]{2}/i)) return "atom";
          if (!stream.match(/^[^%]+/)) stream.next();
          return null;
        },
      });
    case "unicode":
      return StreamLanguage.define({
        name: "unicode",
        token(stream) {
          if (stream.match(/^\\u(?:\{[\da-f]{1,6}\}|[\da-f]{4})/i)) return "atom";
          if (!stream.match(/^[^\\]+/)) stream.next();
          return null;
        },
      });
    case "jwt":
      return createJwtLanguage();
    case "qr":
      return createQrLanguage();
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "js":
    case "javascript":
    case "jsx":
    case "ts":
    case "typescript":
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: ["ts", "typescript", "tsx"].includes(language),
        jsx: ["jsx", "tsx"].includes(language),
      });
    case "html":
      return (await import("@codemirror/lang-html")).html({ autoCloseTags: false });
    case "xml":
      return (await import("@codemirror/lang-xml")).xml({ autoCloseTags: false });
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "yaml":
    case "yml":
      return [(await import("@codemirror/lang-yaml")).yaml(), yamlScalarHighlighting];
    case "markdown":
    case "md":
    case "mkdown":
    case "mkd":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "mermaid": {
      // Reuse the community grammar also used by Mermaid's own documentation editor.
      const { mermaid, foldByIndent, mindmapTags, flowchartTags, sequenceTags } =
        await import("codemirror-lang-mermaid");
      const { mermaidFallbackHighlighting } = await import("./mermaidHighlighting");
      return [
        mermaid(),
        mermaidFallbackHighlighting,
        foldByIndent(),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: Object.values(mindmapTags), color: "var(--syntax-string)" },
            { tag: [flowchartTags.orientation, flowchartTags.link, sequenceTags.arrow], color: "var(--primary)" },
          ]),
        ),
      ];
    }
    case "shell":
    case "sh":
    case "bash":
      return [StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell), callHighlighting];
    // Real grammars give a syntax tree: call/definition highlighting, structural folding and indentation.
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "c":
    case "cpp":
      return (await import("@codemirror/lang-cpp")).cpp();
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "csharp":
      return (await import("@replit/codemirror-lang-csharp")).csharp();
    case "go":
      return (await import("@codemirror/lang-go")).go();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "php":
      // Script files start with `<?php`; skipping the HTML base language keeps the chunk small.
      return (await import("@codemirror/lang-php")).php({ baseLanguage: null });
    // No maintained Lezer grammar exists for these; the stream modes plus call marking cover highlighting.
    case "kotlin":
      return [StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).kotlin), callHighlighting];
    case "ruby":
      return [StreamLanguage.define((await import("@codemirror/legacy-modes/mode/ruby")).ruby), callHighlighting];
    case "csv":
      return createDelimitedLanguage(false);
    case "tsv":
      return createDelimitedLanguage(true);
    default:
      return [];
  }
}

export function loadCodeEditorLanguage(language: string): Promise<Extension> {
  const key = language.trim().toLowerCase();
  let loading = loadedLanguages.get(key);
  if (!loading) {
    loading = importLanguage(key).catch((error: unknown) => {
      loadedLanguages.delete(key);
      throw error;
    });
    loadedLanguages.set(key, loading);
  }
  return loading;
}
