export type TemplateScope = {
  /** Argument names declared in the arguments schema (what the model passes per call). */
  args: readonly string[];
  /** Inputs and secrets (values the admin or agent configures; the model never sees them). */
  inputs: readonly { id: string; secret: boolean; label?: string }[];
  /** Absent when the scope cannot grow (e.g. the arguments schema is not valid JSON). */
  createArg?: (name: string) => void;
  createInput?: (id: string, secret: boolean) => void;
};

export type TemplateSuggestion =
  | { type: "existing"; kind: "args" | "inputs"; name: string; detail: string }
  | { type: "create"; kind: "args" | "inputs"; name: string; secret: boolean; detail: string };

export type TemplateCompletion = {
  /** Replace text[from, to) with the chosen `kind.name`, plus `}}` when it is not already there. */
  from: number;
  to: number;
  closed: boolean;
  suggestions: TemplateSuggestion[];
};

const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_EXISTING = 8;

/** Suggestions for the `{{ ... }}` placeholder the caret is inside, or null when it is not inside one. */
export function templateCompletion(text: string, caret: number, scope: TemplateScope): TemplateCompletion | null {
  const open = text.lastIndexOf("{{", Math.max(0, caret - 2));
  if (open < 0 || open + 2 > caret || text.slice(open + 2, caret).includes("}}")) return null;
  const fragment = text.slice(open + 2, caret).trimStart();
  const parts = fragment.split(".");
  if (
    parts.length > 2 ||
    !/^[A-Za-z]*$/.test(parts[0]) ||
    (parts[1] !== undefined && !/^[A-Za-z0-9_$]*$/.test(parts[1]))
  )
    return null;

  const needle = fragment.toLowerCase();
  const typed = parts.length === 2 ? parts[1] : parts[0];
  const forcedKind = parts.length === 2 ? (parts[0] === "args" || parts[0] === "inputs" ? parts[0] : null) : null;
  if (parts.length === 2 && !forcedKind) return null;

  const existing: TemplateSuggestion[] = [
    ...scope.args.map(
      (name) => ({ type: "existing", kind: "args", name, detail: "Argument the model passes" }) as const,
    ),
    ...scope.inputs.map(
      (input) =>
        ({
          type: "existing",
          kind: "inputs",
          name: input.id,
          detail: input.secret ? "Secret (never sent to the model)" : "Input set per agent",
        }) as const,
    ),
  ].filter((item) => {
    const full = `${item.kind}.${item.name}`.toLowerCase();
    return parts.length === 2
      ? full.startsWith(needle)
      : full.startsWith(needle) || item.name.toLowerCase().startsWith(needle);
  });

  const suggestions: TemplateSuggestion[] = existing.slice(0, MAX_EXISTING);
  const taken = (kind: "args" | "inputs") =>
    (kind === "args" ? scope.args : scope.inputs.map((input) => input.id)).includes(typed);
  if (IDENTIFIER.test(typed) && typed !== "args" && typed !== "inputs") {
    if (
      scope.createArg &&
      (forcedKind ?? "args") === "args" &&
      !taken("args") &&
      !existingHasName(existing, typed, "args")
    )
      suggestions.push({
        type: "create",
        kind: "args",
        name: typed,
        secret: false,
        detail: "Add to the arguments schema",
      });
    if (scope.createInput && (forcedKind ?? "inputs") === "inputs" && !taken("inputs")) {
      suggestions.push({ type: "create", kind: "inputs", name: typed, secret: false, detail: "Add as a text input" });
      suggestions.push({ type: "create", kind: "inputs", name: typed, secret: true, detail: "Add as a secret" });
    }
  }
  if (!suggestions.length) return null;
  const after = text.slice(caret);
  return { from: open + 2, to: caret, closed: /^\s*\}\}/.test(after), suggestions };
}

function existingHasName(items: TemplateSuggestion[], name: string, kind: "args" | "inputs") {
  return items.some((item) => item.kind === kind && item.name === name);
}

/** The text that replaces the typed fragment, and the caret offset (from the start of the field) after it. */
export function applyTemplateSuggestion(
  text: string,
  completion: TemplateCompletion,
  suggestion: TemplateSuggestion,
): { value: string; caret: number } {
  const insert = `${suggestion.kind}.${suggestion.name}`;
  const value = text.slice(0, completion.from) + insert + (completion.closed ? "" : "}}") + text.slice(completion.to);
  const consumed = completion.closed ? text.slice(completion.to).match(/^\s*\}\}/)![0].length : 0;
  return { value, caret: completion.from + insert.length + (completion.closed ? consumed : 2) };
}
