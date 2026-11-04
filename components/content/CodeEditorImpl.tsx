"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Annotation, Compartment, EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as editorPlaceholder,
  rectangularSelection,
  type ViewUpdate,
} from "@codemirror/view";
import {
  HighlightStyle,
  bracketMatching,
  codeFolding,
  foldKeymap,
  foldGutter,
  foldedRanges,
  indentOnInput,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import { SearchQuery } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { ChevronDown, ChevronRight, createElement as createIcon } from "lucide";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CodeEditorHandle, CodeEditorProps } from "./CodeEditor";
import { loadCodeEditorLanguage } from "./codeEditorLanguages";
import { scheduleEditorFeatures } from "./deferredEditorFeatures";
import { indentGuides } from "./indentGuides";
import { rainbowBrackets } from "./rainbowBrackets";
import { createRunActions } from "./codeEditorRunActions";

const EMPTY_EXTENSION: Extension = [];
const EXTERNAL_CHANGE = Annotation.define<boolean>();
// Keep the editing core independent of UIW/basicSetup, which eagerly imports autocomplete.
const BASIC_EXTENSIONS = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
];

const COMPLETION_LANGUAGES = new Set([
  "js",
  "javascript",
  "jsx",
  "ts",
  "typescript",
  "tsx",
  "html",
  "xml",
  "css",
  "sql",
  "mermaid",
  "python",
  "c",
  "cpp",
  "java",
  "csharp",
  "kotlin",
  "go",
  "rust",
  "ruby",
  "php",
  "bash",
  "sh",
  "shell",
]);
const AUTO_COMPLETION_MAX_LENGTH = 100_000;
type CompletionExtensions = Awaited<ReturnType<typeof import("./codeEditorCompletions").loadCodeEditorCompletions>>;

class ColorPreviewWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }

  eq(other: ColorPreviewWidget) {
    return this.color === other.color;
  }

  toDOM(view: EditorView) {
    const swatch = view.dom.ownerDocument.createElement("span");
    swatch.className = "cm-colorPreview";
    swatch.style.backgroundColor = this.color;
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
  }
}

const colorPreviewMatcher = new MatchDecorator({
  regexp: /#[\da-f]{3,8}/gi,
  decorate(add, from, to, match, view) {
    const color = match[0];
    if (![4, 5, 7, 9].includes(color.length)) return;
    const before = view.state.doc.sliceString(Math.max(0, from - 1), from);
    const after = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 1));
    if (/[\p{L}\p{N}_#-]/u.test(before) || /[\p{L}\p{N}_#-]/u.test(after)) return;
    add(from, from, Decoration.widget({ widget: new ColorPreviewWidget(color), side: -1 }));
  },
});

const colorPreviewExtension = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = colorPreviewMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = colorPreviewMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const foldingExtensions = [
  foldGutter({
    markerDOM(open) {
      const marker = document.createElement("span");
      marker.append(
        createIcon(open ? ChevronDown : ChevronRight, { width: "14", height: "14", "aria-hidden": "true" }),
      );
      return marker;
    },
  }),
  codeFolding({
    placeholderDOM(_view, onclick) {
      const placeholder = document.createElement("button");
      placeholder.type = "button";
      placeholder.className = "cm-foldPlaceholder";
      placeholder.textContent = "…";
      placeholder.setAttribute("aria-label", "Expand folded code");
      placeholder.setAttribute("aria-expanded", "false");
      placeholder.onclick = onclick;
      return placeholder;
    },
  }),
];

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    "--code-guide": "color-mix(in srgb, var(--muted-foreground) 13%, transparent)",
    "--code-guide-active": "color-mix(in srgb, var(--primary) 35%, transparent)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    height: "100%",
    overflow: "auto",
    overscrollBehavior: "contain",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-code, 0.75rem)",
    lineHeight: "var(--text-code--line-height, 1.55)",
  },
  ".cm-content": { padding: "18px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 16px 0 4px" },
  ".cm-gutters": {
    backgroundColor: "var(--card)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "30px", padding: "0 0 0 16px" },
  ".cm-run-gutter .cm-gutterElement": { padding: "0 2px 0 6px", display: "flex", alignItems: "center" },
  ".cm-foldGutter": { paddingLeft: "8px" },
  ".cm-lineNumbers + .cm-foldGutter": { paddingLeft: "3px" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 2px" },
  ".cm-foldGutter span": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "14px",
    padding: "0",
    verticalAlign: "middle",
    borderRadius: "4px",
  },
  ".cm-foldGutter span:hover": { color: "var(--foreground)", backgroundColor: "var(--accent)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--accent)",
    color: "var(--primary)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "0 5px",
    font: "inherit",
    lineHeight: "1",
  },
  ".cm-foldPlaceholder:hover": { borderColor: "var(--primary)" },
  ".cm-foldPlaceholder:focus-visible": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-colorPreview": {
    display: "inline-block",
    width: "0.85em",
    height: "0.85em",
    marginRight: "0.3em",
    verticalAlign: "-0.05em",
    border: "1px solid var(--muted-foreground)",
    borderRadius: "1px",
    boxSizing: "border-box",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "var(--text-code, 0.75rem)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-completionDetail": { marginLeft: "1em", fontStyle: "normal", color: "var(--muted-foreground)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600", color: "var(--primary)" },
  ".cm-tooltip.cm-completionInfo": { padding: "0", maxWidth: "min(480px, 60vw)" },
  ".cm-ide-info": {
    display: "grid",
    gap: "6px",
    maxWidth: "min(560px, 70vw)",
    maxHeight: "320px",
    overflow: "auto",
    padding: "8px 10px",
    fontSize: "0.8125rem",
    lineHeight: "1.5",
  },
  ".cm-ide-code": {
    display: "block",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-code, 0.75rem)",
  },
  ".cm-ide-note": { color: "var(--muted-foreground)", fontSize: "0.75rem" },
  ".cm-ide-docs": { whiteSpace: "pre-wrap", borderTop: "1px solid var(--border)", paddingTop: "6px" },
  ".cm-ide-docs code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    backgroundColor: "var(--accent)",
    borderRadius: "3px",
    padding: "0 3px",
  },
  ".cm-ide-activeParam": { fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "3px" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)" },
  ".cm-tooltip-lint": { padding: "0" },
  ".cm-diagnostic": { padding: "6px 10px", fontSize: "0.8125rem" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warning)",
    textUnderlineOffset: "3px",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--accent)",
  },
  ".cm-matchingBracket": { backgroundColor: "var(--accent)", outline: "1px solid var(--input)" },
  ".cm-searchMatch": { backgroundColor: "var(--warning-soft)" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--accent)",
    outline: "1px solid var(--primary)",
  },
  ".cm-searchMatchLine": { backgroundColor: "var(--accent)" },
  ".cm-yaml-scalar, .cm-yaml-scalar span": { color: "var(--warning)" },
  ".cm-rainbow-0": { color: "var(--syntax-bracket-1)" },
  ".cm-rainbow-1": { color: "var(--syntax-bracket-2)" },
  ".cm-rainbow-2": { color: "var(--syntax-bracket-3)" },
  ".cm-rainbow-3": { color: "var(--syntax-bracket-4)" },
  ".cm-rainbow-4": { color: "var(--syntax-bracket-5)" },
  ".cm-rainbow-5": { color: "var(--syntax-bracket-6)" },
});

function createEditorHighlighting(dataKeys: boolean, yamlContent = false) {
  return syntaxHighlighting(
    // Token roles follow VS Code's default themes: control flow, calls, types and constants each read
    // differently while sharing the app's syntax palette.
    HighlightStyle.define([
      { tag: [tags.keyword, tags.tagName, tags.self, tags.definitionKeyword, tags.modifier], color: "var(--primary)" },
      {
        tag: [tags.controlKeyword, tags.moduleKeyword, tags.processingInstruction, tags.macroName],
        color: "var(--syntax-bracket-5)",
      },
      { tag: [tags.variableName, tags.attributeName], color: "var(--foreground)" },
      { tag: tags.propertyName, color: dataKeys ? "var(--primary)" : "var(--foreground)" },
      {
        tag: [
          tags.function(tags.variableName),
          tags.function(tags.propertyName),
          tags.function(tags.definition(tags.variableName)),
        ],
        color: "var(--syntax-bracket-3)",
      },
      { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-bracket-4)" },
      { tag: [tags.standard(tags.typeName), tags.standard(tags.variableName)], color: "var(--syntax-bracket-4)" },
      { tag: [tags.string, tags.regexp, tags.monospace, tags.character], color: "var(--syntax-string)" },
      { tag: tags.escape, color: "var(--syntax-bracket-5)" },
      { tag: tags.content, color: yamlContent ? "var(--syntax-string)" : "var(--foreground)" },
      { tag: tags.labelName, color: yamlContent ? "var(--syntax-bracket-2)" : "var(--foreground)" },
      {
        tag: [tags.number, tags.bool, tags.null, tags.atom],
        color: dataKeys ? "var(--warning)" : "var(--syntax-bracket-1)",
      },
      { tag: tags.constant(tags.variableName), color: "var(--syntax-bracket-1)" },
      { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
      { tag: tags.meta, color: "var(--muted-foreground)" },
      { tag: [tags.heading, tags.link], color: "var(--primary)" },
      { tag: tags.strong, fontWeight: "600" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.invalid, color: "var(--validation)" },
    ]),
  );
}

const codeHighlighting = createEditorHighlighting(false);
const jsonHighlighting = createEditorHighlighting(true);
const yamlHighlighting = createEditorHighlighting(true, true);

function createSearchHighlighting(queryText: string, activeMatch: CodeEditorProps["activeMatch"]) {
  const query = new SearchQuery({ search: queryText, literal: true });
  if (!query.valid) return EMPTY_EXTENSION;
  const matchMark = Decoration.mark({ class: "cm-searchMatch" });
  const activeMark = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

  function decorate(view: EditorView) {
    const ranges: Range<Decoration>[] = [];
    let previousEnd = -1;
    for (const visible of view.visibleRanges) {
      const from = Math.max(0, visible.from - queryText.length);
      const to = Math.min(view.state.doc.length, visible.to + queryText.length);
      const cursor = query.getCursor(view.state, from, to);
      for (let match = cursor.next(); !match.done && ranges.length < 5_000; match = cursor.next()) {
        const { from: start, to: end } = match.value;
        if (end <= visible.from || start >= visible.to || start < previousEnd) continue;
        const mark = start === activeMatch?.from && end === activeMatch.to ? activeMark : matchMark;
        ranges.push(mark.range(start, end));
        previousEnd = end;
      }
    }
    if (activeMatch && activeMatch.from >= 0 && activeMatch.from <= view.state.doc.length) {
      const line = view.state.doc.lineAt(activeMatch.from);
      ranges.push(Decoration.line({ class: "cm-searchMatchLine" }).range(line.from));
    }
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export default function CodeEditorImpl({
  value,
  language,
  onChange,
  id,
  disabled = false,
  readOnly = false,
  required = false,
  maxLength,
  placeholder,
  showLineNumbers = true,
  colorPreviews = false,
  wrap = "soft",
  onCaretChange,
  onScroll,
  editorRef,
  scrollRef,
  searchQuery = "",
  activeMatch,
  ide = false,
  runActions,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const configuration = useMemo(() => new Compartment(), []);
  const [view, setView] = useState<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  // IDE editors also load on pointer entry so hover docs work before the first click.
  const [engaged, setEngaged] = useState(false);
  const [loadedLanguage, setLoadedLanguage] = useState<{ name: string; extension: Extension } | null>(null);
  const [loadedCompletion, setLoadedCompletion] = useState<{
    name: string;
    extensions: CompletionExtensions;
  } | null>(null);
  const callbacks = useRef({ onChange, onCaretChange, onScroll, maxLength });
  callbacks.current = { onChange, onCaretChange, onScroll, maxLength };
  const runActionsRef = useRef(runActions);
  runActionsRef.current = runActions;
  const hasRunActions = Boolean(runActions);
  const runActionsExtension = useMemo(
    () => (hasRunActions ? createRunActions(() => runActionsRef.current!) : EMPTY_EXTENSION),
    [hasRunActions],
  );
  const languageName = language.trim().toLowerCase();
  const languageExtension = loadedLanguage?.name === languageName ? loadedLanguage.extension : EMPTY_EXTENSION;
  const isReadOnly = readOnly || disabled || !onChange;
  // Suggestions are optional: editing works before their deferred import resolves.
  const completionExtension =
    isReadOnly || loadedCompletion?.name !== languageName
      ? EMPTY_EXTENSION
      : value.length > AUTO_COMPLETION_MAX_LENGTH
        ? loadedCompletion.extensions.manual
        : loadedCompletion.extensions.automatic;
  const searchHighlighting = useMemo(
    () => createSearchHighlighting(searchQuery, activeMatch),
    [searchQuery, activeMatch?.from, activeMatch?.to],
  );

  useEffect(() => {
    let active = true;
    // Native language packages can themselves import autocomplete. Defer the whole
    // language boundary until after page load, not just the completion extension.
    const cancel = scheduleEditorFeatures(() => {
      loadCodeEditorLanguage(languageName).then(
        (extension) => {
          if (active) setLoadedLanguage({ name: languageName, extension });
        },
        () => {
          if (active) setLoadedLanguage({ name: languageName, extension: EMPTY_EXTENSION });
        },
      );
    });
    return () => {
      active = false;
      cancel();
    };
  }, [languageName]);

  useEffect(() => {
    if (
      !(focused || engaged) ||
      isReadOnly ||
      !COMPLETION_LANGUAGES.has(languageName) ||
      loadedCompletion?.name === languageName
    )
      return;
    let active = true;
    const cancel = scheduleEditorFeatures(() => {
      import("./codeEditorCompletions")
        .then(({ loadCodeEditorCompletions }) => loadCodeEditorCompletions(languageName, ide))
        .then((extensions) => {
          if (active) setLoadedCompletion({ name: languageName, extensions });
        })
        // A failed optional chunk must not interrupt typing; a later focus retries.
        .catch(() => {});
    });
    return () => {
      active = false;
      cancel();
    };
  }, [focused, engaged, ide, isReadOnly, languageName, loadedCompletion?.name]);

  const interactionExtensions = useMemo(
    () => [
      EditorState.transactionFilter.of((transaction) => {
        const limit = callbacks.current.maxLength;
        if (
          transaction.docChanged &&
          !transaction.annotation(EXTERNAL_CHANGE) &&
          !transaction.isUserEvent("undo") &&
          !transaction.isUserEvent("redo") &&
          limit !== undefined &&
          limit >= 0 &&
          transaction.newDoc.length > limit &&
          transaction.newDoc.length > transaction.startState.doc.length
        ) {
          return [];
        }
        return transaction;
      }),
      EditorView.domEventHandlers({
        scroll(event, currentView) {
          if (event.target === currentView.scrollDOM) callbacks.current.onScroll?.(currentView.scrollDOM);
        },
      }),
    ],
    [],
  );

  const extensions = useMemo(() => {
    const contentAttributes: Record<string, string> = {
      role: "textbox",
      "aria-multiline": "true",
      "aria-readonly": String(isReadOnly),
      "aria-disabled": String(disabled),
      "aria-required": String(required),
      tabindex: disabled ? "-1" : "0",
      spellcheck: "false",
      autocapitalize: "off",
      autocorrect: "off",
    };
    if (id) contentAttributes.id = id;
    if (ariaLabel) contentAttributes["aria-label"] = ariaLabel;
    if (ariaLabelledBy) contentAttributes["aria-labelledby"] = ariaLabelledBy;
    if (ariaDescribedBy) contentAttributes["aria-describedby"] = ariaDescribedBy;
    if (ariaInvalid !== undefined) contentAttributes["aria-invalid"] = String(ariaInvalid);
    return [
      languageName === "json"
        ? jsonHighlighting
        : languageName === "yaml" || languageName === "yml"
          ? yamlHighlighting
          : codeHighlighting,
      searchHighlighting,
      ...(colorPreviews ? [colorPreviewExtension] : []),
      rainbowBrackets,
      ...(languageName === "csv" || languageName === "tsv" ? [] : [indentGuides]),
      interactionExtensions,
      languageExtension,
      completionExtension,
      EditorView.contentAttributes.of(contentAttributes),
      EditorState.readOnly.of(isReadOnly),
      EditorView.editable.of(!disabled),
      ...(placeholder ? [editorPlaceholder(placeholder)] : []),
      ...(showLineNumbers ? [lineNumbers()] : []),
      runActionsExtension,
      ...(hasRunActions ? [] : [foldingExtensions]),
      ...(wrap === "off" ? [] : [EditorView.lineWrapping]),
    ];
  }, [
    id,
    isReadOnly,
    disabled,
    required,
    placeholder,
    ariaLabel,
    ariaLabelledBy,
    ariaDescribedBy,
    ariaInvalid,
    interactionExtensions,
    languageExtension,
    completionExtension,
    languageName,
    searchHighlighting,
    showLineNumbers,
    colorPreviews,
    wrap,
    runActionsExtension,
    hasRunActions,
  ]);

  const reportCaret = useCallback((currentView: EditorView) => {
    const head = currentView.state.selection.main.head;
    const line = currentView.state.doc.lineAt(head);
    callbacks.current.onCaretChange?.({ line: line.number, column: head - line.from + 1 });
  }, []);

  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      if (update.selectionSet || update.docChanged || update.focusChanged) reportCaret(update.view);
      if (update.focusChanged) setFocused(update.view.hasFocus);
      if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(EXTERNAL_CHANGE))) {
        callbacks.current.onChange?.(update.state.doc.toString());
      }
    },
    [reportCaret],
  );
  const initialEditor = useRef({ value, extensions });
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const currentView = new EditorView({
      parent: containerRef.current,
      doc: initialEditor.current.value,
      extensions: [
        BASIC_EXTENSIONS,
        editorTheme,
        EditorView.updateListener.of(handleUpdate),
        configuration.of(initialEditor.current.extensions),
      ],
    });
    setView(currentView);
    return () => currentView.destroy();
  }, [configuration, handleUpdate]);

  useEffect(() => {
    if (view) view.dispatch({ effects: configuration.reconfigure(extensions) });
  }, [view, configuration, extensions]);

  useEffect(() => {
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: EXTERNAL_CHANGE.of(true),
    });
  }, [view, value]);

  useImperativeHandle<CodeEditorHandle | null, CodeEditorHandle | null>(
    editorRef,
    () =>
      view
        ? {
            focus: () => view.focus(),
            scrollDOM: view.scrollDOM,
            scrollToLine(lineNumber, column = 1) {
              const line = view.state.doc.line(
                Math.max(1, Math.min(view.state.doc.lines, Math.trunc(lineNumber) || 1)),
              );
              const position = line.from + Math.max(0, Math.min(line.length, Math.trunc(column) - 1 || 0));
              view.dispatch({
                selection: { anchor: position },
                effects: EditorView.scrollIntoView(position, { y: "center" }),
              });
            },
          }
        : null,
    [view],
  );

  useEffect(() => {
    if (!view) return;
    reportCaret(view);
    if (!scrollRef) return;
    if (typeof scrollRef !== "function") {
      scrollRef.current = view.scrollDOM;
      return () => {
        scrollRef.current = null;
      };
    }
    const cleanup = scrollRef(view.scrollDOM);
    return () => {
      if (typeof cleanup === "function") cleanup();
      else scrollRef(null);
    };
  }, [view, scrollRef, reportCaret]);

  useEffect(() => {
    if (!view || !activeMatch) return;
    const from = Math.max(0, Math.min(view.state.doc.length, activeMatch.from));
    const to = Math.max(from, Math.min(view.state.doc.length, activeMatch.to));
    const unfoldEffects: ReturnType<typeof unfoldEffect.of>[] = [];
    foldedRanges(view.state).between(from, to, (foldFrom, foldTo) => {
      if (foldFrom < to && foldTo > from) unfoldEffects.push(unfoldEffect.of({ from: foldFrom, to: foldTo }));
    });
    view.dispatch({
      effects: [...unfoldEffects, EditorView.scrollIntoView(from, { y: "center" })],
    });
  }, [view, activeMatch?.from, activeMatch?.to, value]);

  return (
    <div
      className="h-full min-h-0 min-w-0"
      onPointerEnter={ide && !engaged ? () => setEngaged(true) : undefined}
      ref={containerRef}
    />
  );
}
