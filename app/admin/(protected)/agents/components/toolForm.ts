import {
  DEFAULT_HTTP_TIMEOUT_MS,
  toolInputSchema,
  type CODE_TOOL_LANGUAGES,
  type CustomTool,
  type HTTP_METHODS,
  type OUTPUT_PARSERS,
  type TOOL_INPUT_TYPES,
  type TOOL_KINDS,
  type ToolInput,
} from "@/lib/agents/toolTypes.ts";
import { schemaTextError } from "./agentForm";

export type Pair = { name: string; value: string };
export type InputFieldForm = {
  /** Client-only stable key for React and drag-and-drop; stripped before saving. */
  rowKey: string;
  id: string;
  label: string;
  type: (typeof TOOL_INPUT_TYPES)[number];
  required: boolean;
  defaultValue: string;
  description: string;
};

/** Editable, text-friendly stand-in for ToolInput. */
export type ToolForm = {
  /** Set for an endpoint of a connection; fixed after creation. */
  connectionId: string | null;
  key: string;
  name: string;
  description: string;
  kind: (typeof TOOL_KINDS)[number];
  enabled: boolean;
  requiresApproval: boolean;
  argsText: string;
  inputs: InputFieldForm[];
  /** Shared secret values typed this session, by field id: "" clears a saved one, absent keeps it. */
  secretValues: Record<string, string>;
  /** Secret ids with a saved shared value (the value itself never reaches the browser). */
  savedSecretValues: string[];
  method: (typeof HTTP_METHODS)[number];
  url: string;
  headers: Pair[];
  query: Pair[];
  bodyText: string;
  responsePath: string;
  timeoutSeconds: string;
  language: (typeof CODE_TOOL_LANGUAGES)[number];
  source: string;
  parser: (typeof OUTPUT_PARSERS)[number];
  transformLanguage: (typeof CODE_TOOL_LANGUAGES)[number];
  transformSource: string;
  outputMode: "freeform" | "schema";
  schemaText: string;
};

const json = (value: unknown) => JSON.stringify(value, null, 2);
const EMPTY_OBJECT_SCHEMA = json({ type: "object", properties: {}, required: [] });
const STARTER_JS = `const { args, inputs } = JSON.parse(require("fs").readFileSync(0, "utf8"));\nconsole.log(JSON.stringify({ ok: true, args }));\n`;
const TRANSFORM_JS = `const { body } = JSON.parse(require("fs").readFileSync(0, "utf8"));\nconsole.log(JSON.stringify(JSON.parse(body)));\n`;

export const starterSource = (language: ToolForm["language"], transform = false) =>
  language === "python"
    ? transform
      ? `import json, sys\ndata = json.load(sys.stdin)\nprint(json.dumps(json.loads(data["body"])))\n`
      : `import json, sys\ndata = json.load(sys.stdin)\nprint(json.dumps({"ok": True, "args": data["args"]}))\n`
    : transform
      ? TRANSFORM_JS
      : STARTER_JS;

const words = (text: string) => text.match(/[A-Za-z0-9]+/g) ?? [];

/** "API Key" → "apiKey": an input id suggested from its label. */
export function idFromLabel(label: string): string {
  const id = words(label)
    .map((word, index) => (index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join("")
    .slice(0, 64);
  return /^[0-9]/.test(id) ? `n${id}` : id;
}

/** "Web Search" → "web_search": a key suggested from a name. */
export function keyFromName(name: string, max = 48): string {
  const key = words(name).join("_").toLowerCase().slice(0, max).replace(/_+$/, "");
  return /^[0-9]/.test(key) ? `k_${key}`.slice(0, max) : key;
}

/** A suggested value keeps following its source until the admin edits it by hand. */
export const follows = (current: string, previousSource: string, suggest: (source: string) => string) =>
  current === "" || current === suggest(previousSource);

/** Rows added in this session (saved rows use "row-N"); only their ids follow the label. */
export const isNewRow = (field: InputFieldForm) => !field.rowKey.startsWith("row-");

/** Rows for an input field list (tools and connections). */
export const inputsToForm = (inputs: CustomTool["inputs"]): InputFieldForm[] =>
  inputs.map((field, index) => ({
    ...field,
    rowKey: `row-${index}`,
    defaultValue: field.defaultValue ?? "",
    description: field.description ?? "",
  }));

/** Saved shape of input rows: client keys dropped, blanks to null, secrets never carry a default. */
export const inputsFromForm = (rows: InputFieldForm[]) =>
  rows.map(({ rowKey: _rowKey, ...field }) => ({
    ...field,
    defaultValue: field.type === "secret" ? null : field.defaultValue || null,
    description: field.description.trim() || null,
  }));

/** Shared values to submit, limited to current secret fields so renamed ids do not linger. */
export const sharedSecretsFromForm = (rows: InputFieldForm[], values: Record<string, string>) =>
  Object.fromEntries(
    rows.filter((field) => field.type === "secret" && field.id in values).map((field) => [field.id, values[field.id]]),
  );

export const pairsOf = (record: Record<string, string> | undefined): Pair[] =>
  Object.entries(record ?? {}).map(([name, value]) => ({ name, value }));

export function toolToForm(tool: CustomTool | null, connectionId: string | null = null): ToolForm {
  const pairs = pairsOf;
  return {
    connectionId: tool ? tool.connectionId : connectionId,
    key: tool?.key ?? "",
    name: tool?.name ?? "",
    description: tool?.description ?? "",
    kind: tool?.kind ?? "http",
    enabled: tool?.enabled ?? true,
    requiresApproval: tool?.requiresApproval ?? false,
    argsText: tool ? json(tool.argsSchema) : EMPTY_OBJECT_SCHEMA,
    inputs: inputsToForm(tool?.inputs ?? []),
    secretValues: {},
    savedSecretValues: tool?.savedSecretValues ?? [],
    method: tool?.http?.method ?? "GET",
    url: tool?.http?.url ?? "",
    headers: pairs(tool?.http?.headers),
    query: pairs(tool?.http?.query),
    bodyText: tool?.http?.body != null ? json(tool.http.body) : "",
    responsePath: tool?.http?.responsePath ?? "",
    timeoutSeconds: String((tool?.http?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS) / 1000),
    language: tool?.code?.language ?? "javascript",
    source: tool?.code?.source ?? STARTER_JS,
    parser: tool?.output.parser ?? "auto",
    transformLanguage: tool?.output.transform?.language ?? "javascript",
    transformSource: tool?.output.transform?.source ?? TRANSFORM_JS,
    outputMode: tool?.output.schema ? "schema" : "freeform",
    schemaText: tool?.output.schema ? json(tool.output.schema) : EMPTY_OBJECT_SCHEMA,
  };
}

export const toRecord = (pairs: Pair[]) =>
  Object.fromEntries(pairs.filter((pair) => pair.name.trim()).map((pair) => [pair.name.trim(), pair.value]));

function parseJson(text: string, key: string, errors: Record<string, string>): unknown {
  const error = schemaTextError(text);
  if (error) {
    errors[key] = error;
    return undefined;
  }
  return JSON.parse(text);
}

/** Parses the form into a validated payload, or per-field messages keyed by dot path (e.g. "http.url"). */
export function parseToolForm(
  form: ToolForm,
): { ok: true; input: ToolInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const argsSchema = parseJson(form.argsText, "argsSchema", errors);
  const body = form.bodyText.trim() ? parseJson(form.bodyText, "http.body", errors) : null;
  const schema = form.outputMode === "schema" ? parseJson(form.schemaText, "output.schema", errors) : null;
  const parsed = toolInputSchema.safeParse({
    key: form.key,
    name: form.name,
    description: form.description,
    kind: form.kind,
    argsSchema,
    inputs: inputsFromForm(form.inputs),
    http:
      form.kind === "http"
        ? {
            method: form.method,
            url: form.url,
            headers: toRecord(form.headers),
            query: toRecord(form.query),
            body,
            responsePath: form.responsePath.trim() || null,
            timeoutMs: Math.round(Number(form.timeoutSeconds) * 1000),
          }
        : null,
    code: form.kind === "code" ? { language: form.language, source: form.source } : null,
    output: {
      parser: form.parser,
      transform: form.parser === "code" ? { language: form.transformLanguage, source: form.transformSource } : null,
      schema,
    },
    requiresApproval: form.requiresApproval,
    enabled: form.enabled,
    connectionId: form.connectionId,
    secretValues: form.connectionId ? {} : sharedSecretsFromForm(form.inputs, form.secretValues),
  });
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors[path === "http.timeoutMs" ? "http.timeoutSeconds" : path || "form"] ??= issue.message;
    }
  return Object.keys(errors).length || !parsed.success ? { ok: false, errors } : { ok: true, input: parsed.data };
}
