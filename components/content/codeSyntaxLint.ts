import { ensureSyntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";

/** Languages whose grammar marks the exact spot where the code stops making sense. */
const PARSED = new Set(["python", "c", "cpp", "java", "go", "rust", "php"]);
/** Grammars without a trustworthy error report: only brackets and quotes are checked. */
const BALANCED = new Set(["csharp", "kotlin"]);

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

function point(state: EditorState, from: number, to = from + 1) {
  const length = state.doc.length;
  const end = Math.min(Math.max(to, from + 1), length);
  return { from: Math.max(0, Math.min(from, end - 1)), to: end };
}

/** Only the first error is reported: later ones are usually fallout from it, like in a compiler. */
function parsedDiagnostics(state: EditorState, language: string): Diagnostic[] {
  // Java switch expressions (`case 1 -> ...`) are newer than the grammar and would be flagged though valid.
  if (language === "java" && /\bcase\b[^\n:]*->|\byield\b/.test(state.doc.toString())) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, 300);
  if (!tree) return [];
  let found: Diagnostic | null = null;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (!node.type.isError) return;
      const text = state.sliceDoc(node.from, node.to).trim();
      const { from, to } = point(state, node.from, node.to);
      found = {
        from,
        to,
        severity: "error",
        message: text
          ? `Unexpected "${text.length > 24 ? `${text.slice(0, 24)}…` : text}". Something before it may be missing or extra.`
          : "The code stops making sense here. A closing bracket, quote, colon or semicolon may be missing.",
      };
      return false;
    },
  });
  return found ? [found] : [];
}

/** Brackets and quotes for C-style languages (C#, Kotlin). Skips comments, strings and characters. */
function balancedDiagnostics(state: EditorState, language: string): Diagnostic[] {
  const text = state.doc.toString();
  const kotlin = language === "kotlin";
  const stack: { char: string; at: number }[] = [];
  const problem = (at: number, message: string, to = at + 1): Diagnostic[] => [
    { ...point(state, at, to), severity: "error", message },
  ];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return problem(i, "This comment is never closed. Add */ at the end.", i + 2);
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const start = i;
      if (c === '"' && text.startsWith('"""', i)) {
        const end = text.indexOf('"""', i + 3);
        if (end < 0) return problem(start, 'This """ string is never closed.', start + 3);
        i = end + 2;
        continue;
      }
      const verbatim = c === '"' && text[i - 1] === "@";
      const interpolated = c === '"' && (kotlin || text[i - 1] === "$" || text[i - 2] === "$");
      let depth = 0;
      for (i++; i < text.length; i++) {
        const d = text[i];
        if (depth === 0 && d === c) {
          if (verbatim && text[i + 1] === c) i++;
          else break;
        } else if (depth === 0 && d === "\n" && !verbatim) {
          return problem(start, "This string or character is never closed. Add the closing quote.", i);
        } else if (d === "\\" && !verbatim) i++;
        else if (interpolated && d === "{" && (kotlin ? text[i - 1] === "$" : true)) depth++;
        else if (interpolated && d === "}" && depth > 0) depth--;
      }
      if (i >= text.length)
        return problem(start, "This string or character is never closed. Add the closing quote.", start + 1);
    } else if (OPENERS[c]) stack.push({ char: c, at: i });
    else if (CLOSERS.has(c)) {
      const open = stack.pop();
      if (!open) return problem(i, `This "${c}" has no matching opening bracket.`);
      if (OPENERS[open.char] !== c)
        return problem(
          i,
          `Expected "${OPENERS[open.char]}" to close the "${open.char}" on line ${state.doc.lineAt(open.at).number}, but found "${c}".`,
        );
    }
  }
  const open = stack.pop();
  return open ? problem(open.at, `This "${open.char}" is never closed. Add "${OPENERS[open.char]}".`) : [];
}

/** Parentheses and quotes in SQL. Exact syntax errors come from the database when the query runs. */
function sqlDiagnostics(state: EditorState): Diagnostic[] {
  const text = state.doc.toString();
  const opens: number[] = [];
  const problem = (at: number, message: string, to = at + 1): Diagnostic[] => [
    { ...point(state, at, to), severity: "error", message },
  ];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return problem(i, "This comment is never closed. Add */ at the end.", i + 2);
      i = end + 1;
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(text.slice(i, i + 40))) {
      // PostgreSQL dollar-quoted body: anything goes until the same tag appears again.
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 40))![0];
      const end = text.indexOf(tag, i + tag.length);
      if (end < 0) return problem(i, `This ${tag} block is never closed.`, i + tag.length);
      i = end + tag.length - 1;
    } else if (c === "'" || c === '"' || c === "`") {
      const end = text.indexOf(c, i + 1);
      // A doubled quote ('') is an escaped quote: the loop reads it as a close then an open.
      if (end < 0) return problem(i, `This ${c === "'" ? "string" : "name"} is never closed. Add the closing ${c}.`);
      i = end;
    } else if (c === "(") opens.push(i);
    else if (c === ")" && !opens.pop()) return problem(i, 'This ")" has no matching "(".');
  }
  const open = opens.pop();
  return open === undefined ? [] : problem(open, 'This "(" is never closed. Add ")".');
}

/** Editor-side syntax errors for a compiler language; `null` when the language has no reliable check. */
export function syntaxLintFor(language: string): Extension | null {
  if (PARSED.has(language)) return linter((view) => parsedDiagnostics(view.state, language), { delay: 500 });
  if (BALANCED.has(language)) return linter((view) => balancedDiagnostics(view.state, language), { delay: 500 });
  if (language === "sql") return linter((view) => sqlDiagnostics(view.state), { delay: 500 });
  return null;
}
