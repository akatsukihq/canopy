import { ensureSyntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";

/** Tags whose closing tag HTML lets you leave out. */
const OPTIONAL_CLOSE = new Set([
  "p",
  "li",
  "dt",
  "dd",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "tfoot",
  "option",
  "optgroup",
  "colgroup",
  "head",
  "body",
  "html",
]);

/** A zero-width error still needs something to underline: widen it to the nearest character. */
function span(state: EditorState, from: number, to: number) {
  const length = state.doc.length;
  if (to > from) return { from, to };
  return from > 0 ? { from: from - 1, to: Math.min(from, length) } : { from, to: Math.min(from + 1, length) };
}

function cssDiagnostics(state: EditorState): Diagnostic[] {
  const found: Diagnostic[] = [];
  ensureSyntaxTree(state, state.doc.length, 300)?.iterate({
    enter(node) {
      if (node.type.isError) {
        const { from, to } = span(state, node.from, node.to);
        const text = state.sliceDoc(from, to);
        found.push({
          from,
          to,
          severity: "error",
          message:
            text === "}"
              ? "This closing brace has no matching opening brace."
              : "CSS can't read this. A brace, colon or semicolon may be missing or misplaced.",
        });
      } else if (node.name === "PropertyName") {
        const name = state.sliceDoc(node.from, node.to);
        // Custom properties and vendor prefixes are valid even when this browser doesn't know them.
        if (name.startsWith("-") || typeof CSS === "undefined" || CSS.supports(name, "initial")) return;
        let inRule = false;
        for (let parent = node.node.parent; parent; parent = parent.parent)
          if (parent.name === "RuleSet") inRule = true;
        if (inRule)
          found.push({
            from: node.from,
            to: node.to,
            severity: "warning",
            message: `"${name}" is not a CSS property this browser knows. Check the spelling.`,
          });
      }
    },
  });
  return found;
}

function htmlDiagnostics(state: EditorState): Diagnostic[] {
  const found: Diagnostic[] = [];
  const tagName = (from: number, to: number, name: string) =>
    state
      .sliceDoc(from, to)
      .replace(/^<\/?/, "")
      .replace(/[\s>/].*$/s, "") || name;
  ensureSyntaxTree(state, state.doc.length, 300)?.iterate({
    enter(node) {
      if (node.name === "MismatchedCloseTag") {
        found.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: `</${tagName(node.from, node.to, "tag")}> doesn't match any open tag here. Remove it or fix the nesting.`,
        });
      } else if (node.name === "Element") {
        const open = node.node.getChild("OpenTag");
        if (!open || node.node.getChild("CloseTag")) return;
        const name = tagName(open.from, open.to, "tag").toLowerCase();
        if (OPTIONAL_CLOSE.has(name)) return;
        found.push({
          from: open.from,
          to: open.to,
          severity: "error",
          message: `<${name}> is never closed. Add </${name}>.`,
        });
      }
    },
  });
  return found;
}

const DELAY = { delay: 400 };
export const cssLint = linter((view) => cssDiagnostics(view.state), DELAY);
export const htmlLint = linter((view) => htmlDiagnostics(view.state), DELAY);
