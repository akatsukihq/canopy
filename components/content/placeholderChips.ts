import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";

class PlaceholderChipWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }

  eq(other: PlaceholderChipWidget) {
    return this.name === other.name;
  }

  toDOM(view: EditorView) {
    const chip = view.dom.ownerDocument.createElement("span");
    chip.className = "cm-placeholderChip";
    chip.setAttribute("aria-label", `Placeholder ${this.name}`);
    chip.textContent = this.name;
    return chip;
  }

  ignoreEvent() {
    return false;
  }
}

// Simple ICU arguments only; `{count, plural, ...}` has a comma and never matches.
const matcher = new MatchDecorator({
  regexp: /\{([A-Za-z_][\w.]*)\}/g,
  decoration: (match) => Decoration.replace({ widget: new PlaceholderChipWidget(match[1]) }),
});

/** Renders `{name}` as an atomic chip; the document text is unchanged. */
export const placeholderChipsExtension = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);
