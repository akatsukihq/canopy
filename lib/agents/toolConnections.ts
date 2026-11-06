/**
 * Connections: one API's shared base URL, inputs/secrets and headers. Each endpoint is an HTTP custom tool with
 * `connectionId` set whose url is a path. Pure: safe for client and server.
 */
import { z } from "zod";
import { placeholders, splitUrlTemplate } from "./toolTemplate.ts";
import {
  HEADER_NAME,
  sharedSecretIssue,
  sharedSecretValuesSchema,
  toolInputFieldSchema,
  type CustomTool,
  type ToolInputField,
} from "./toolTypes.ts";

const headerName = z.string().regex(HEADER_NAME, "Use letters, numbers, hyphens, underscores and dots.");

export const toolConnectionInputSchema = z
  .object({
    /** Prefix for imported endpoint keys. */
    key: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores, starting with a letter."),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000),
    /** Fixed `https://host[/prefix]` or one leading `{{inputs.<url input>}}`, optionally followed by a prefix. */
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((url) => !/[?#]/.test(url), "Leave out the query string; endpoints add their own."),
    inputs: z
      .array(toolInputFieldSchema)
      .max(20)
      .refine((list) => new Set(list.map((field) => field.id)).size === list.length, "Input ids must be unique."),
    headers: z.record(headerName, z.string().max(4000)),
    enabled: z.boolean(),
    secretValues: sharedSecretValuesSchema,
  })
  .strict()
  .superRefine((connection, ctx) => {
    for (const issue of connectionIssues(connection)) ctx.addIssue({ code: "custom", ...issue });
    const stray = sharedSecretIssue(connection.secretValues, connection.inputs);
    if (stray) ctx.addIssue({ code: "custom", ...stray });
  });
export type ToolConnectionInput = z.infer<typeof toolConnectionInputSchema>;
export type ToolConnection = Omit<ToolConnectionInput, "secretValues"> & {
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Secret fields with a shared value stored on the connection. */
  savedSecretValues: string[];
};

type Issue = { path: (string | number)[]; message: string };

/** Base URL origin rule and `{{inputs.*}}`-only placeholders in the base URL and headers. */
function connectionIssues(connection: Pick<ToolConnectionInput, "baseUrl" | "headers" | "inputs">): Issue[] {
  const issues: Issue[] = [];
  const split = splitUrlTemplate(connection.baseUrl);
  if ("error" in split) issues.push({ path: ["baseUrl"], message: split.error });
  else if ("input" in split.origin) {
    const id = split.origin.input;
    if (connection.inputs.find((field) => field.id === id)?.type !== "url")
      issues.push({ path: ["baseUrl"], message: `{{inputs.${id}}} must be a declared input of type URL.` });
  }
  const parts = { baseUrl: connection.baseUrl, headers: connection.headers };
  for (const [part, value] of Object.entries(parts))
    for (const { kind, path } of placeholders(value)) {
      if (kind === "args")
        issues.push({ path: [part], message: `{{args.${path}}} is not allowed here; endpoints use arguments.` });
      else if (path.includes(".") || !connection.inputs.some((field) => field.id === path))
        issues.push({ path: [part], message: `{{inputs.${path}}} is not a declared input.` });
    }
  return issues;
}

type Bindable = Pick<CustomTool, "http" | "inputs" | "enabled">;

/**
 * An endpoint as an ordinary tool: url = base URL + path, the endpoint's headers override the connection's
 * (case-insensitive), inputs = the connection's. A disabled connection disables its endpoints.
 */
export function bindConnection<T extends Bindable>(
  tool: T,
  connection: Pick<ToolConnectionInput, "baseUrl" | "headers" | "inputs" | "enabled">,
): T & { inputs: ToolInputField[] } {
  if (!tool.http) return { ...tool, inputs: connection.inputs, enabled: tool.enabled && connection.enabled };
  const own = new Set(Object.keys(tool.http.headers).map((name) => name.toLowerCase()));
  const shared = Object.entries(connection.headers).filter(([name]) => !own.has(name.toLowerCase()));
  return {
    ...tool,
    inputs: connection.inputs,
    enabled: tool.enabled && connection.enabled,
    http: {
      ...tool.http,
      url: connection.baseUrl.replace(/\/+$/, "") + tool.http.url,
      headers: { ...Object.fromEntries(shared), ...tool.http.headers },
    },
  };
}
