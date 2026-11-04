import { highlightingFor, language as languageFacet } from "@codemirror/language";
import { highlightSelectionMatches, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { indentWithTab } from "@codemirror/commands";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

/** What the editor shows when hovering a name: its declaration or type, then its documentation. */
export interface HoverInfo {
  from: number;
  to: number;
  signature: string;
  docs?: string;
  /** Short plain-language context such as "function · line 4". */
  note?: string;
}

/** Parameter hints for the call around the cursor. */
export interface SignatureInfo {
  prefix: string;
  params: { label: string; docs?: string }[];
  separator: string;
  suffix: string;
  docs?: string;
  active: number;
}

/** One editor's source of language knowledge: in-file symbols, a language service, or both. */
export interface IntelligenceProvider {
  hover(view: EditorView, pos: number): Promise<HoverInfo | null> | HoverInfo | null;
  definition(view: EditorView, pos: number): Promise<number | null> | number | null;
  signature(view: EditorView, pos: number): Promise<SignatureInfo | null> | SignatureInfo | null;
  update?(update: ViewUpdate): void;
  destroy?(): void;
}

/** Renders `text` with the editor's own grammar and colours, like VS Code's hover code blocks. */
function renderCode(state: EditorState, text: string) {
  const element = document.createElement("code");
  element.className = "cm-ide-code";
  const parser = state.facet(languageFacet)?.parser;
  if (!parser || text.length > 2_000) {
    element.textContent = text;
    return element;
  }
  let position = 0;
  const write = (to: number, className = "") => {
    if (to <= position) return;
    const chunk = text.slice(position, to);
    if (className) {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = chunk;
      element.append(span);
    } else element.append(chunk);
    position = to;
  };
  highlightTree(parser.parse(text), { style: (tags) => highlightingFor(state, tags) }, (from, to, className) => {
    write(from);
    write(to, className);
  });
  write(text.length);
  return element;
}

function renderDocs(docs: string | undefined) {
  const element = document.createElement("div");
  element.className = "cm-ide-docs";
  // Inline `code` spans render as code; everything else stays readable prose.
  for (const [index, part] of (docs ?? "").split("`").entries()) {
    if (index % 2) {
      const code = document.createElement("code");
      code.textContent = part;
      element.append(code);
    } else element.append(part);
  }
  return element;
}

/** Hover card and completion-info panel share one layout. */
export function renderInfo(state: EditorState, signature: string, docs?: string, note?: string) {
  const element = document.createElement("div");
  element.className = "cm-ide-info";
  if (signature) element.append(renderCode(state, signature));
  if (note) {
    const noteElement = document.createElement("div");
    noteElement.className = "cm-ide-note";
    noteElement.textContent = note;
    element.append(noteElement);
  }
  if (docs) element.append(renderDocs(docs));
  return element;
}

function renderSignature(info: SignatureInfo) {
  const element = document.createElement("div");
  element.className = "cm-ide-info cm-ide-signatureHelp";
  const line = document.createElement("code");
  line.className = "cm-ide-code";
  line.append(info.prefix);
  info.params.forEach((param, index) => {
    if (index) line.append(info.separator);
    const span = document.createElement("span");
    span.textContent = param.label;
    if (index === info.active) span.className = "cm-ide-activeParam";
    line.append(span);
  });
  line.append(info.suffix);
  element.append(line);
  const activeDocs = info.params[info.active]?.docs;
  if (activeDocs) element.append(renderDocs(`${info.params[info.active].label}: ${activeDocs}`));
  if (info.docs) element.append(renderDocs(info.docs));
  return element;
}

const setSignature = StateEffect.define<{ pos: number; info: SignatureInfo } | null>();
const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignature)) {
        const value = effect.value;
        return value ? { pos: value.pos, above: true, create: () => ({ dom: renderSignature(value.info) }) } : null;
      }
    }
    return tooltip && transaction.docChanged ? { ...tooltip, pos: transaction.changes.mapPos(tooltip.pos) } : tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

function jumpTo(view: EditorView, target: number | null) {
  if (target === null || target < 0 || target > view.state.doc.length) return false;
  view.dispatch({
    selection: { anchor: target },
    effects: EditorView.scrollIntoView(target, { y: "center" }),
    userEvent: "select",
  });
  return true;
}

/** VS Code-style editing intelligence driven by one provider per editor. */
export function ideExtensions(createProvider: (view: EditorView) => IntelligenceProvider): Extension {
  const providerPlugin = ViewPlugin.define((view) => {
    const provider = createProvider(view);
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSignature = (force: boolean) => {
      const open = view.state.field(signatureField, false);
      if (!open && !force) return;
      clearTimeout(timer);
      const id = ++request;
      timer = setTimeout(async () => {
        const pos = view.state.selection.main.head;
        const info = view.state.selection.main.empty ? await provider.signature(view, pos) : null;
        if (id === request) view.dispatch({ effects: setSignature.of(info ? { pos, info } : null) });
      }, 60);
    };
    return {
      provider,
      refreshSignature,
      update(update: ViewUpdate) {
        provider.update?.(update);
        if (!update.docChanged && !update.selectionSet) return;
        const typed = update.transactions.some((transaction) => {
          let opener = false;
          transaction.changes.iterChanges((_from, _to, _fromB, _toB, inserted) => {
            // Auto-closing inserts "()" in one change, so test the first typed character.
            if (/^[(,]/.test(inserted.toString())) opener = true;
          });
          return opener && transaction.isUserEvent("input");
        });
        refreshSignature(typed);
      },
      destroy() {
        clearTimeout(timer);
        provider.destroy?.();
      },
    };
  });
  const providerOf = (view: EditorView) => view.plugin(providerPlugin)?.provider;
  const goToDefinition = (view: EditorView, pos = view.state.selection.main.head) => {
    const provider = providerOf(view);
    if (!provider) return false;
    void Promise.resolve(provider.definition(view, pos)).then((target) => jumpTo(view, target));
    return true;
  };

  return [
    providerPlugin,
    signatureField,
    hoverTooltip(
      async (view, pos) => {
        const info = await providerOf(view)?.hover(view, pos);
        if (!info) return null;
        return {
          pos: info.from,
          end: info.to,
          above: true,
          create: () => ({ dom: renderInfo(view.state, info.signature, info.docs, info.note) }),
        };
      },
      { hoverTime: 350 },
    ),
    highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2, wholeWords: true }),
    // VS Code puts extra cursors on Alt-click so Cmd/Ctrl-click can go to a definition.
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        event.preventDefault();
        return goToDefinition(view, pos);
      },
    }),
    keymap.of([
      { key: "F12", run: (view) => goToDefinition(view) },
      { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
      { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
      {
        key: "Mod-Shift-Space",
        run: (view) => {
          view.plugin(providerPlugin)?.refreshSignature(true);
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(signatureField, false)) return false;
          view.dispatch({ effects: setSignature.of(null) });
          return true;
        },
      },
      // Tab indents like VS Code; Escape then Tab still moves focus out (CodeMirror's a11y escape hatch).
      indentWithTab,
    ]),
  ];
}
