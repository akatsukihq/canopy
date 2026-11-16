export type TemplateKind = "args" | "inputs" | "secrets";

export type TemplateScope = {
  /** Argument names declared in the arguments schema (what the model passes per call). */
  args: readonly string[];
  /** Declared inputs and secrets (values the admin or agent configures; the model never sees them). */
  inputs: readonly { id: string; secret: boolean; label?: string }[];
  /** Absent when the scope cannot grow (e.g. the arguments schema is not valid JSON). */
  createArg?: (name: string) => void;
  createInput?: (id: string, secret: boolean) => void;
};

export type TemplateSuggestion =
  | { type: "namespace"; kind: TemplateKind; name: ""; detail: string }
  | { type: "existing"; kind: TemplateKind; name: string; detail: string }
  | { type: "create"; kind: TemplateKind; name: string; detail: string };

export type TemplateCompletion = {
  /** Replace text[from, to) with the chosen `kind.name`, plus `}}` when it is not already there. */
  from: number;
  to: number;
  closed: boolean;
  suggestions: TemplateSuggestion[];
};

const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_EXISTING = 8;

const NAMESPACES: { kind: TemplateKind; detail: string; existing: string; create: string }[] = [
  {
    kind: "args",
    detail: "Arguments the model passes",
    existing: "Argument the model passes",
    create: "Add to the arguments schema",
  },
  {
    kind: "inputs",
    detail: "Settings set per agent",
    existing: "Input set per agent",
    create: "Add as an input",
  },
  {
    kind: "secrets",
    detail: "Keys and tokens, never sent to the model",
    existing: "Secret (never sent to the model)",
    create: "Add as a secret",
  },
];

/** Names declared under one namespace. */
function declared(scope: TemplateScope, kind: TemplateKind): string[] {
  if (kind === "args") return [...scope.args];
  return scope.inputs.filter((input) => input.secret === (kind === "secrets")).map((input) => input.id);
}

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

  const dotted = parts.length === 2;
  const forced = dotted ? NAMESPACES.find((namespace) => namespace.kind === parts[0]) : undefined;
  if (dotted && !forced) return null;

  const needle = fragment.toLowerCase();
  const typed = dotted ? parts[1] : parts[0];
  const suggestions: TemplateSuggestion[] = [];

  if (!dotted)
    for (const { kind, detail } of NAMESPACES)
      if (kind.startsWith(needle)) suggestions.push({ type: "namespace", kind, name: "", detail });

  const existing: TemplateSuggestion[] = NAMESPACES.filter(({ kind }) => !forced || kind === forced.kind).flatMap(
    ({ kind, existing: detail }) =>
      declared(scope, kind)
        .filter((name) =>
          dotted
            ? `${kind}.${name}`.toLowerCase().startsWith(needle)
            : `${kind}.${name}`.toLowerCase().startsWith(needle) || name.toLowerCase().startsWith(needle),
        )
        .map((name) => ({ type: "existing", kind, name, detail }) as const),
  );
  suggestions.push(...existing.slice(0, MAX_EXISTING));

  // Names are created only after a namespace (`args.` / `inputs.` / `secrets.`); the namespaces themselves are fixed.
  if (forced && IDENTIFIER.test(typed) && !declared(scope, forced.kind).includes(typed)) {
    const canCreate = forced.kind === "args" ? scope.createArg : scope.createInput;
    if (canCreate) suggestions.push({ type: "create", kind: forced.kind, name: typed, detail: forced.create });
  }
  if (!suggestions.length) return null;
  const after = text.slice(caret);
  return { from: open + 2, to: caret, closed: /^\s*\}\}/.test(after), suggestions };
}

/** The text that replaces the typed fragment, and the caret offset (from the start of the field) after it. */
export function applyTemplateSuggestion(
  text: string,
  completion: TemplateCompletion,
  suggestion: TemplateSuggestion,
): { value: string; caret: number } {
  if (suggestion.type === "namespace") {
    const insert = `${suggestion.kind}.`;
    return {
      value: text.slice(0, completion.from) + insert + text.slice(completion.to),
      caret: completion.from + insert.length,
    };
  }
  const insert = `${suggestion.kind}.${suggestion.name}`;
  const value = text.slice(0, completion.from) + insert + (completion.closed ? "" : "}}") + text.slice(completion.to);
  const consumed = completion.closed ? text.slice(completion.to).match(/^\s*\}\}/)![0].length : 0;
  return { value, caret: completion.from + insert.length + (completion.closed ? consumed : 2) };
}
