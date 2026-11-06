/**
 * Maps an OpenAPI 3.x document to a connection draft plus one HTTP endpoint tool per operation. Pure: the
 * result is a proposal the admin reviews; the server re-validates everything on create.
 */
import { load } from "js-yaml";
import { bindConnection, toolConnectionInputSchema, type ToolConnectionInput } from "./toolConnections.ts";
import {
  argumentNames,
  DEFAULT_HTTP_TIMEOUT_MS,
  HEADER_NAME,
  httpTemplateIssues,
  toolInputSchema,
  type ToolInput,
  type ToolInputField,
} from "./toolTypes.ts";

export type ImportedEndpoint = {
  /** "GET /users/{id}" */
  label: string;
  tool: ToolInput | null;
  /** Why the operation cannot be imported (tool is null). */
  error: string | null;
  notes: string[];
};
export type OpenApiPreview = { connection: ToolConnectionInput; endpoints: ImportedEndpoint[]; warnings: string[] };
export type OpenApiResult = { ok: true; preview: OpenApiPreview } | { ok: false; error: string };

type Json = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const MAX_REF_DEPTH = 6;
const KEEP = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "description",
  "title",
  "default",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "anyOf",
  "oneOf",
  "allOf",
  "additionalProperties",
]);

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** "listUsers" / "List users!" → "list_users". */
export function snake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A placeholder-safe identifier: letters, digits, underscores, starting with a letter. */
function identifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `${fallback}_${cleaned}`;
}

function unique(base: string, taken: Set<string>, max = 64): string {
  let name = base.slice(0, max);
  for (let n = 2; taken.has(name); n++) name = `${base.slice(0, max - String(n).length - 1)}_${n}`;
  taken.add(name);
  return name;
}

function parseDocument(source: string): Json | string {
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch {
    try {
      doc = load(source);
    } catch {
      return "The file is not valid JSON or YAML.";
    }
  }
  if (!isObject(doc)) return "The file is not an OpenAPI document.";
  if (typeof doc.swagger === "string")
    return "Swagger 2.0 is not supported. Convert it to OpenAPI 3 first, then import it again.";
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3."))
    return 'The document has no "openapi": "3.x" field. Only OpenAPI 3.0 and 3.1 are supported.';
  if (!isObject(doc.paths) || !Object.keys(doc.paths).length) return "The document has no paths.";
  return doc;
}

/** Follows a local `#/...` reference. */
function pointer(doc: Json, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let value: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const part = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(value) && !Array.isArray(value)) return undefined;
    value = (value as Json)[part];
  }
  return value;
}

/** Resolves a `$ref` object (parameters, request bodies); non-refs pass through. */
function deref(doc: Json, value: unknown, seen: string[] = []): unknown {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  if (seen.includes(value.$ref) || seen.length > MAX_REF_DEPTH) return undefined;
  return deref(doc, pointer(doc, value.$ref), [...seen, value.$ref]);
}

const validPattern = (pattern: unknown) => {
  if (typeof pattern !== "string") return false;
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
};

/**
 * OpenAPI schema → JSON Schema the validator accepts: local refs inlined (cycles and deep nesting become `{}`),
 * unknown keywords and invalid patterns dropped, `nullable` → a null type, read-only properties left out of
 * request schemas.
 */
export function cleanSchema(doc: Json, schema: unknown, seen: string[] = []): Json {
  if (!isObject(schema)) return {};
  if (typeof schema.$ref === "string") {
    if (seen.includes(schema.$ref) || seen.length >= MAX_REF_DEPTH) return {};
    return cleanSchema(doc, pointer(doc, schema.$ref), [...seen, schema.$ref]);
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!KEEP.has(key)) continue;
    if (key === "pattern" && !validPattern(value)) continue;
    if ((key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof value !== "number") continue;
    if (key === "properties" && isObject(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value)
          .filter(([, prop]) => !(isObject(prop) && prop.readOnly === true))
          .map(([name, prop]) => [name, cleanSchema(doc, prop, seen)]),
      );
    } else if (key === "items") out.items = Array.isArray(value) ? {} : cleanSchema(doc, value, seen);
    else if (key === "additionalProperties")
      out.additionalProperties = typeof value === "boolean" ? value : cleanSchema(doc, value, seen);
    else if (key === "anyOf" || key === "oneOf" || key === "allOf")
      out[key] = Array.isArray(value) ? value.map((item) => cleanSchema(doc, item, seen)) : undefined;
    else out[key] = value;
  }
  if (Array.isArray(out.required) && isObject(out.properties)) {
    const names = Object.keys(out.properties);
    out.required = out.required.filter((name) => typeof name === "string" && names.includes(name));
    if (!(out.required as unknown[]).length) delete out.required;
  }
  if (schema.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    else return { anyOf: [out, { type: "null" }] };
  }
  return out;
}

/** Server URL with `{variables}` filled from their defaults. */
function serverUrl(doc: Json): string {
  const server = Array.isArray(doc.servers) && isObject(doc.servers[0]) ? doc.servers[0] : null;
  let url = text(server?.url);
  const variables = isObject(server?.variables) ? server.variables : {};
  url = url.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const variable = variables[name];
    return isObject(variable) && typeof variable.default === "string" ? variable.default : match;
  });
  return url.replace(/\/+$/, "");
}

type Auth = { inputs: ToolInputField[]; headers: Record<string, string>; query: Record<string, string> };

function securityInputs(doc: Json, taken: Set<string>, warnings: string[]): Auth {
  const auth: Auth = { inputs: [], headers: {}, query: {} };
  const schemes =
    isObject(doc.components) && isObject(doc.components.securitySchemes) ? doc.components.securitySchemes : {};
  for (const [name, raw] of Object.entries(schemes)) {
    const scheme = deref(doc, raw);
    if (!isObject(scheme)) continue;
    const type = text(scheme.type);
    const bearer = type === "http" && text(scheme.scheme).toLowerCase() === "bearer";
    const apiKey = type === "apiKey" && (scheme.in === "header" || scheme.in === "query");
    if (!bearer && !apiKey) {
      warnings.push(`"${name}" (${type || "unknown"} auth) is not supported. Add a header on the connection instead.`);
      continue;
    }
    const id = unique(identifier(name, "key"), taken);
    auth.inputs.push({
      id,
      label: cut(name, 80),
      type: "secret",
      required: true,
      defaultValue: null,
      description: text(scheme.description) ? cut(text(scheme.description), 300) : null,
    });
    const value = `{{inputs.${id}}}`;
    if (bearer) auth.headers.Authorization = `Bearer ${value}`;
    else if (scheme.in === "query") auth.query[text(scheme.name) || id] = value;
    else if (HEADER_NAME.test(text(scheme.name))) auth.headers[text(scheme.name)] = value;
    else {
      auth.inputs.pop();
      warnings.push(`"${name}" uses an unsupported header name and was skipped.`);
    }
  }
  if (auth.inputs.length > 1)
    warnings.push("Several auth schemes were found and each became a required secret. Delete the ones you don't use.");
  return auth;
}

function connectionDraft(
  doc: Json,
  warnings: string[],
): { connection: ToolConnectionInput; query: Record<string, string> } {
  const info = isObject(doc.info) ? doc.info : {};
  const title = text(info.title) || "API";
  const taken = new Set<string>();
  const auth = securityInputs(doc, taken, warnings);
  const inputs: ToolInputField[] = [];
  const server = serverUrl(doc);
  let baseUrl = server;
  if (!/^https:\/\/[^/?#{}\s]+/i.test(server)) {
    const id = unique("baseUrl", taken);
    inputs.push({
      id,
      label: "Base URL",
      type: "url",
      required: true,
      defaultValue: null,
      description: "The API's https address, e.g. https://api.example.com.",
    });
    baseUrl = server.startsWith("/") ? `{{inputs.${id}}}${server}` : `{{inputs.${id}}}`;
    warnings.push(
      server
        ? `The server address "${server}" is not an absolute https URL, so each agent enters a Base URL.`
        : "The document lists no server, so each agent enters a Base URL.",
    );
  }
  const key = snake(title).slice(0, 24).replace(/_+$/, "");
  return {
    connection: {
      key: /^[a-z]/.test(key) && key.length >= 2 ? key : `api_${key}`.slice(0, 24).replace(/_+$/, ""),
      name: cut(title, 80),
      description: cut(text(info.description), 1000),
      baseUrl,
      inputs: [...inputs, ...auth.inputs],
      headers: auth.headers,
      enabled: true,
      secretValues: {},
    },
    query: auth.query,
  };
}

type Parameter = { name: string; in: string; required: boolean; schema: Json; description: string };

function parameters(doc: Json, ...lists: unknown[]): Parameter[] {
  const byKey = new Map<string, Parameter>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const param = deref(doc, raw);
      if (!isObject(param) || !text(param.name) || !text(param.in)) continue;
      byKey.set(`${param.in}:${param.name}`, {
        name: text(param.name),
        in: text(param.in),
        required: param.in === "path" || param.required === true,
        schema: cleanSchema(doc, param.schema ?? { type: "string" }),
        description: text(param.description),
      });
    }
  }
  return [...byKey.values()];
}

function jsonBody(doc: Json, raw: unknown): { schema: Json; required: boolean } | { error: string } | null {
  const body = deref(doc, raw);
  if (!isObject(body) || !isObject(body.content)) return null;
  const type = Object.keys(body.content).find((name) => /(^|\/|\+)json\b/i.test(name));
  if (!type) return { error: `Only JSON request bodies are supported (this one is ${Object.keys(body.content)[0]}).` };
  const media = body.content[type];
  return { schema: cleanSchema(doc, isObject(media) ? media.schema : {}), required: body.required === true };
}

function endpoint(
  doc: Json,
  path: string,
  method: (typeof METHODS)[number],
  operation: Json,
  pathItem: Json,
  context: { connection: ToolConnectionInput; authQuery: Record<string, string>; keys: Set<string> },
): ImportedEndpoint {
  const METHOD = method.toUpperCase() as Uppercase<typeof method>;
  const label = `${METHOD} ${path}`;
  const notes: string[] = [];
  const failed = (error: string): ImportedEndpoint => ({ label, tool: null, error, notes });

  const properties: Json = {};
  const required: string[] = [];
  const argNames = new Set<string>();
  const pathArgs = new Map<string, string>();
  const query: Record<string, string> = { ...context.authQuery };
  for (const param of parameters(doc, pathItem.parameters, operation.parameters)) {
    if (param.in !== "path" && param.in !== "query") {
      notes.push(`${param.in} parameter "${param.name}" skipped.`);
      continue;
    }
    const arg = unique(identifier(param.name, "param"), argNames);
    properties[arg] = param.description ? { ...param.schema, description: cut(param.description, 500) } : param.schema;
    if (param.required) required.push(arg);
    if (param.in === "path") pathArgs.set(param.name, arg);
    else query[param.name] = `{{args.${arg}}}`;
  }
  let missingPath = null as string | null;
  const url = path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const arg = pathArgs.get(name);
    if (!arg) missingPath = name;
    return `{{args.${arg ?? name}}}`;
  });
  if (missingPath) return failed(`The path parameter "${missingPath}" is not declared.`);

  let body: unknown = null;
  const requestBody = jsonBody(doc, operation.requestBody);
  if (requestBody && "error" in requestBody) return failed(requestBody.error);
  if (requestBody) {
    if (method === "get") notes.push("GET request body ignored.");
    else {
      const arg = unique("body", argNames);
      properties[arg] = requestBody.schema;
      if (requestBody.required) required.push(arg);
      body = `{{args.${arg}}}`;
    }
  }

  const summary = text(operation.summary);
  const description = [summary, text(operation.description)].filter(Boolean).join("\n\n") || label;
  const name = snake(text(operation.operationId) || `${method} ${path.replace(/[{}]/g, "")}`) || method;
  const draft = {
    key: unique(`${context.connection.key}_${name}`.slice(0, 48).replace(/_+$/, ""), context.keys, 48),
    name: cut(summary || label, 80),
    description: cut(description, 1000),
    kind: "http" as const,
    argsSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    inputs: [],
    http: {
      method: METHOD,
      url,
      headers: {},
      query,
      body,
      responsePath: null,
      timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    },
    code: null,
    output: { parser: "auto" as const, transform: null, schema: null },
    requiresApproval: method !== "get",
    enabled: true,
    connectionId: "import",
  };
  const parsed = toolInputSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(`${issue.path.join(".") || "tool"}: ${issue.message}`);
  }
  const bound = bindConnection(parsed.data, context.connection);
  const issue = bound.http && httpTemplateIssues(bound.http, argumentNames(bound.argsSchema), bound.inputs)[0];
  if (issue) return failed(issue.message);
  return { label, tool: { ...parsed.data, connectionId: null }, error: null, notes };
}

/** Parses an OpenAPI document (JSON or YAML) into a reviewable connection + endpoints proposal. */
export function previewOpenApi(source: string): OpenApiResult {
  const doc = parseDocument(source);
  if (typeof doc === "string") return { ok: false, error: doc };
  const warnings: string[] = [];
  const { connection, query } = connectionDraft(doc, warnings);
  const checked = toolConnectionInputSchema.safeParse(connection);
  if (!checked.success) return { ok: false, error: `Connection: ${checked.error.issues[0].message}` };
  const keys = new Set<string>();
  const endpoints: ImportedEndpoint[] = [];
  for (const [path, raw] of Object.entries(doc.paths as Json)) {
    const pathItem = deref(doc, raw);
    if (!isObject(pathItem)) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (isObject(operation))
        endpoints.push(endpoint(doc, path, method, operation, pathItem, { connection, authQuery: query, keys }));
    }
  }
  if (!endpoints.length) return { ok: false, error: "The document has no GET, POST, PUT, PATCH or DELETE operations." };
  return { ok: true, preview: { connection: checked.data, endpoints, warnings } };
}
