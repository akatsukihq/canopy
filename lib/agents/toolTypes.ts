/**
 * Contract for admin-defined custom tools (HTTP and code templates). Safe for client and server: a template
 * holds no secrets; secret values live on each agent's attachment.
 */
import { z } from "zod";
import { placeholders, splitUrlTemplate } from "./toolTemplate.ts";
import { jsonObjectSchema } from "./types.ts";

export const TOOL_KINDS = ["http", "code"] as const;
export const TOOL_INPUT_TYPES = ["text", "secret", "url", "number", "json"] as const;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const CODE_TOOL_LANGUAGES = ["javascript", "python"] as const;
export const OUTPUT_PARSERS = ["auto", "json", "text", "html-text", "code"] as const;
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
export const ENDPOINT_PATH_RULE = "Start the path with /, e.g. /users/{{args.id}}.";
const MAX_SOURCE_BYTES = 64 * 1024;
const FIELD_ID = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** True when text parses as JSON (used by "json" inputs). */
export function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export const toolInputFieldSchema = z
  .object({
    id: z.string().max(64).regex(FIELD_ID, "Start with a letter; use letters, numbers and underscores."),
    label: z.string().trim().min(1).max(80),
    type: z.enum(TOOL_INPUT_TYPES),
    required: z.boolean(),
    defaultValue: z.string().max(4000).nullable(),
    description: z.string().trim().max(300).nullable(),
  })
  .strict()
  .refine((field) => field.type !== "secret" || field.defaultValue === null, {
    path: ["defaultValue"],
    message: "Secret fields cannot have a default value.",
  })
  .refine((field) => field.type !== "json" || !field.defaultValue || isJson(field.defaultValue), {
    path: ["defaultValue"],
    message: "Default must be valid JSON.",
  });
export type ToolInputField = z.infer<typeof toolInputFieldSchema>;

/**
 * Write-only shared secret values, keyed by secret field id: a string sets it, "" clears it, null keeps the stored
 * one. Stored encrypted; reads only report which fields have one (`savedSecretValues`).
 */
/** HTTP header names: RFC 9110 token characters in common use. */
export const HEADER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export const sharedSecretValuesSchema = z
  .record(z.string().regex(FIELD_ID), z.string().max(4000).nullable())
  .default({});

/** Shared values may only be given for declared secret fields. */
export const sharedSecretIssue = (values: Record<string, unknown>, inputs: ToolInputField[]) => {
  const stray = Object.keys(values).find((id) => inputs.find((field) => field.id === id)?.type !== "secret");
  return stray ? { path: ["secretValues", stray], message: `${stray} is not a secret field.` } : null;
};

export const httpToolConfigSchema = z
  .object({
    method: z.enum(HTTP_METHODS),
    url: z.string().trim().min(1).max(2000),
    headers: z.record(
      z.string().regex(HEADER_NAME, "Use letters, numbers, hyphens, underscores and dots."),
      z.string().max(4000),
    ),
    query: z.record(z.string().min(1).max(128), z.string().max(4000)),
    body: z
      .json()
      .nullable()
      .refine((body) => bytes(JSON.stringify(body)) <= MAX_SOURCE_BYTES, "The body template is too large (64 KB max)."),
    /** Dot path into the JSON response, e.g. "data.items". */
    responsePath: z
      .string()
      .trim()
      .max(200)
      .regex(/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/, 'Use a dot path such as "data.items".')
      .nullable(),
    timeoutMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();
export type HttpToolConfig = z.infer<typeof httpToolConfigSchema>;

export const codeToolConfigSchema = z
  .object({
    language: z.enum(CODE_TOOL_LANGUAGES),
    source: z
      .string()
      .refine((source) => source.trim().length > 0, "Write the code.")
      .refine((source) => bytes(source) <= MAX_SOURCE_BYTES, "The code is too large (64 KB max)."),
  })
  .strict();
export type CodeToolConfig = z.infer<typeof codeToolConfigSchema>;

export const toolOutputConfigSchema = z
  .object({
    parser: z.enum(OUTPUT_PARSERS),
    /** Required when parser = "code": stdin = raw result, stdout = parsed value. */
    transform: codeToolConfigSchema.nullable(),
    /** null = freeform. Otherwise the parsed value must match. */
    schema: jsonObjectSchema("output schema").nullable(),
  })
  .strict()
  .refine((output) => (output.parser === "code") === (output.transform !== null), {
    path: ["transform"],
    message: "A transform is required for the code parser, and only for it.",
  });
export type ToolOutputConfig = z.infer<typeof toolOutputConfigSchema>;

/** Top-level argument names declared by an object JSON Schema. */
export function argumentNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  return properties && typeof properties === "object" ? Object.keys(properties) : [];
}

type Issue = { path: (string | number)[]; message: string };

/** Origin rule and placeholder references of an HTTP template. */
export function httpTemplateIssues(http: HttpToolConfig, args: string[], inputs: ToolInputField[]): Issue[] {
  const issues: Issue[] = [];
  const split = splitUrlTemplate(http.url);
  if ("error" in split) issues.push({ path: ["http", "url"], message: split.error });
  else if ("input" in split.origin) {
    const id = split.origin.input;
    const field = inputs.find((entry) => entry.id === id);
    if (field?.type !== "url")
      issues.push({ path: ["http", "url"], message: `{{inputs.${id}}} must be a declared input of type URL.` });
  }
  const parts = { url: http.url, headers: http.headers, query: http.query, body: http.body };
  for (const [part, value] of Object.entries(parts)) {
    for (const { kind, path } of placeholders(value)) {
      const name = path.split(".")[0];
      const known = kind === "args" ? args.includes(name) : !path.includes(".") && inputs.some((f) => f.id === name);
      if (!known)
        issues.push({
          path: ["http", part],
          message: `{{${kind}.${path}}} is not a declared ${kind === "args" ? "argument" : "input"}.`,
        });
    }
  }
  return issues;
}

export const toolInputSchema = z
  .object({
    /** Becomes the model-facing tool name `custom_<key>`. */
    key: z
      .string()
      .trim()
      .min(2)
      .max(48)
      .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores, starting with a letter."),
    name: z.string().trim().min(1).max(80),
    /** Model-facing: decides when the model calls the tool. */
    description: z.string().trim().min(1).max(1000),
    kind: z.enum(TOOL_KINDS),
    argsSchema: jsonObjectSchema("arguments schema"),
    inputs: z
      .array(toolInputFieldSchema)
      .max(20)
      .refine((list) => new Set(list.map((field) => field.id)).size === list.length, "Input ids must be unique."),
    http: httpToolConfigSchema.nullable(),
    code: codeToolConfigSchema.nullable(),
    output: toolOutputConfigSchema,
    requiresApproval: z.boolean(),
    enabled: z.boolean(),
    /** Endpoint of a connection: HTTP only, no own inputs, url is a path joined to the connection's base URL. */
    connectionId: z.string().min(1).nullable().default(null),
    secretValues: sharedSecretValuesSchema,
  })
  .strict()
  .superRefine((tool, ctx) => {
    if (tool.kind === "http" && !tool.http)
      ctx.addIssue({ code: "custom", path: ["http"], message: "Set up the request." });
    if (tool.kind === "code" && !tool.code)
      ctx.addIssue({ code: "custom", path: ["code"], message: "Write the code." });
    const stray = sharedSecretIssue(tool.secretValues, tool.inputs);
    if (stray) ctx.addIssue({ code: "custom", ...stray });
    if (tool.connectionId) {
      if (tool.kind !== "http")
        ctx.addIssue({ code: "custom", path: ["kind"], message: "Connection endpoints are HTTP tools." });
      if (tool.inputs.length)
        ctx.addIssue({ code: "custom", path: ["inputs"], message: "Endpoints use the connection's inputs." });
      if (tool.http && !tool.http.url.startsWith("/"))
        ctx.addIssue({ code: "custom", path: ["http", "url"], message: ENDPOINT_PATH_RULE });
      return; // Placeholders are checked once the connection is loaded (store: bindConnection + httpTemplateIssues).
    }
    if (tool.kind === "http" && tool.http)
      for (const issue of httpTemplateIssues(tool.http, argumentNames(tool.argsSchema), tool.inputs))
        ctx.addIssue({ code: "custom", ...issue });
  })
  .transform((tool) => ({
    ...tool,
    http: tool.kind === "http" ? tool.http : null,
    code: tool.kind === "code" ? tool.code : null,
  }));
export type ToolInput = z.infer<typeof toolInputSchema>;
export type CustomTool = Omit<ToolInput, "secretValues"> & {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Secret fields with a shared value stored on the tool. */
  savedSecretValues: string[];
};

/** Model-facing name of a custom tool. */
export const customToolName = (key: string) => `custom_${key}`;
