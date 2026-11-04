import { type Extension, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import {
  ClipboardPaste,
  Copy,
  createElement as createIcon,
  ListTree,
  Play,
  Scissors,
  ScanSearch,
  TextSelect,
} from "lucide";

import type { CodeEditorRunActions } from "./CodeEditor";

type Range = { readonly from: number; readonly to: number };
type MenuItem = { label: string; icon: Parameters<typeof createIcon>[0]; disabled?: boolean; onSelect: () => void };

class RunMarker extends GutterMarker {
  constructor(readonly label: string) {
    super();
  }
  eq(other: RunMarker) {
    return other.label === this.label;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.setAttribute("aria-label", this.label);
    button.className =
      "flex size-5 items-center justify-center rounded-sm text-primary hover:bg-accent hover:[&_svg]:fill-current";
    button.append(createIcon(Play, { width: 12, height: 12 }));
    return button;
  }
}

/** Groups are separated by a rule; an empty group is skipped. */
function showMenu(x: number, y: number, groups: readonly (readonly MenuItem[])[]) {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.className =
    "fixed z-50 min-w-48 rounded-lg border border-input bg-popover p-1 text-popover-foreground shadow-md";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", close);
  };
  const onPointerDown = (event: Event) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  const buttons: HTMLButtonElement[] = [];
  groups
    .filter((group) => group.length > 0)
    .forEach((group, index) => {
      if (index > 0) {
        const rule = document.createElement("div");
        rule.setAttribute("role", "separator");
        rule.className = "-mx-1 my-1 h-px bg-border";
        menu.append(rule);
      }
      for (const item of group) {
        const button = document.createElement("button");
        button.type = "button";
        button.disabled = Boolean(item.disabled);
        button.setAttribute("role", "menuitem");
        button.className =
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
        button.append(createIcon(item.icon, { width: 14, height: 14 }), item.label);
        button.addEventListener("click", () => {
          close();
          item.onSelect();
        });
        buttons.push(button);
        menu.append(button);
      }
    });
  menu.addEventListener("keydown", (event) => {
    const enabled = buttons.filter((button) => !button.disabled);
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") enabled[(at + 1) % enabled.length]?.focus({ preventScroll: true });
    else if (event.key === "ArrowUp")
      enabled[(at - 1 + enabled.length) % enabled.length]?.focus({ preventScroll: true });
    else return;
    event.preventDefault();
  });
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", close);
  document.body.append(menu);
  buttons.find((button) => !button.disabled)?.focus({ preventScroll: true });
}

/** `get` returns the latest actions, so the extension is built once and never rebuilt on re-render. */
export function createRunActions(get: () => CodeEditorRunActions): Extension {
  const ranges = StateField.define<readonly Range[]>({
    create: (state) => get().find(state.doc.toString()),
    update: (value, transaction) => (transaction.docChanged ? get().find(transaction.state.doc.toString()) : value),
  });
  const rangeAt = (view: EditorView, lineFrom: number, lineTo: number) =>
    view.state.field(ranges).find((range) => range.from >= lineFrom && range.from <= lineTo);

  return [
    ranges,
    gutter({
      class: "cm-run-gutter",
      initialSpacer: () => new RunMarker(""),
      lineMarker: (view, line) => (rangeAt(view, line.from, line.to) ? new RunMarker(get().labels.run) : null),
      lineMarkerChange: (update) => update.docChanged,
      domEventHandlers: {
        mousedown(view, line, event) {
          const range = rangeAt(view, line.from, line.to);
          if (!range) return false;
          event.preventDefault();
          get().onRun(range);
          return true;
        },
      },
    }),
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        event.preventDefault();
        const { labels, onRun, onRunAll, onExplain } = get();
        // A right-click outside the selection moves the cursor there first, so "this statement" is the one clicked.
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const inSelection =
          at !== null && view.state.selection.ranges.some((r) => !r.empty && at >= r.from && at <= r.to);
        if (at !== null && !inSelection) view.dispatch({ selection: { anchor: at } });
        const selection = view.state.selection.main;
        const hasSelection = !selection.empty;
        const editable = view.state.facet(EditorView.editable) && !view.state.readOnly;
        const head = selection.head;
        const statements = view.state.field(ranges);
        // The statement under the cursor, or the last one that started before it.
        const current =
          statements.find((range) => head >= range.from && head <= range.to) ??
          [...statements].reverse().find((range) => range.from <= head);
        const target = hasSelection ? { from: selection.from, to: selection.to } : current;
        const selected = () => view.state.sliceDoc(selection.from, selection.to);
        showMenu(event.clientX, event.clientY, [
          [
            ...(hasSelection
              ? [
                  {
                    label: labels.runSelection,
                    icon: Play,
                    onSelect: () => onRun({ from: selection.from, to: selection.to }),
                  },
                ]
              : []),
            ...(current ? [{ label: labels.runStatement, icon: Play, onSelect: () => onRun(current) }] : []),
            { label: labels.runAll, icon: Play, onSelect: onRunAll },
          ],
          // Without an `explain` label (an engine with no bytecode view) only the plan is offered.
          onExplain && labels.explainPlan && target
            ? [
                { label: labels.explainPlan, icon: ListTree, onSelect: () => onExplain(target, "plan") },
                ...(labels.explain
                  ? [{ label: labels.explain, icon: ScanSearch, onSelect: () => onExplain(target, "bytecode") }]
                  : []),
              ]
            : [],
          [
            {
              label: labels.cut,
              icon: Scissors,
              disabled: !hasSelection || !editable,
              onSelect: () => {
                void navigator.clipboard.writeText(selected());
                view.dispatch({ changes: { from: selection.from, to: selection.to }, userEvent: "delete.cut" });
                view.focus();
              },
            },
            {
              label: labels.copy,
              icon: Copy,
              disabled: !hasSelection,
              onSelect: () => {
                void navigator.clipboard.writeText(selected());
                view.focus();
              },
            },
            {
              label: labels.paste,
              icon: ClipboardPaste,
              disabled: !editable,
              onSelect: () => {
                void navigator.clipboard
                  .readText()
                  .then((text) =>
                    view.dispatch({
                      changes: { from: selection.from, to: selection.to, insert: text },
                      selection: { anchor: selection.from + text.length },
                      userEvent: "input.paste",
                    }),
                  )
                  .catch(() => undefined)
                  .finally(() => view.focus());
              },
            },
            {
              label: labels.selectAll,
              icon: TextSelect,
              onSelect: () => {
                view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
                view.focus();
              },
            },
          ],
        ]);
        return true;
      },
    }),
  ];
}
