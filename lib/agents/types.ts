/**
 * Shared contract for admin-configured AI agents, skills and MCP servers.
 * Safe for client and server: no secrets, no server-only imports.
 */
import { z } from "zod";
import { AI_EFFORTS } from "../ai/types.ts";

/** Assistant sections that can host agents. Each section supplies its own context. */
export const AGENT_SECTIONS = ["blog-editor", "blog-generation", "tool-content"] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];
export const AGENT_SECTION_LABELS: Record<AgentSection, string> = {
  "blog-editor": "Blog editor",
  "blog-generation": "Blog generation",
  "tool-content": "Tool content",
};

/** Server tools implemented in code that an agent may be granted. */
export const BUILTIN_TOOLS = ["generate_image"] as const;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

export const SUBAGENT_MODES = ["none", "delegate", "pipeline"] as const;
export type SubagentMode = (typeof SUBAGENT_MODES)[number];

/** Max nesting when a delegated subagent itself delegates. Enforced on save and at runtime. */
export const MAX_AGENT_DEPTH = 2;
export const MAX_PIPELINE_STEPS = 8;
const MAX_SCHEMA_BYTES = 64 * 1024;

const key = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens, starting with a letter.");

/** Keywords z.fromJSONSchema accepts but does not enforce; rejecting them avoids rules that silently do nothing. */
const UNENFORCED_KEYWORDS = new Set(["contains", "minContains", "maxContains"]);
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
function unenforcedKeyword(node: unknown): string | undefined {
  if (Array.isArray(node)) return node.map(unenforcedKeyword).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  for (const [name, child] of Object.entries(node)) {
    if (UNENFORCED_KEYWORDS.has(name)) return name;
    const found =
      SCHEMA_MAPS.has(name) && child && typeof child === "object"
        ? Object.values(child).map(unenforcedKeyword).find(Boolean)
        : unenforcedKeyword(child);
    if (found) return found;
  }
  return undefined;
}

/** A JSON Schema object with root `{ "type": "object" }` that z.fromJSONSchema can enforce. `label` names it in messages. */
export function jsonObjectSchema(label: string) {
  return z
    .record(z.string(), z.unknown())
    .refine((value) => value.type === "object", `The ${label} root must be { "type": "object" }.`)
    .refine(
      (value) => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_SCHEMA_BYTES,
      `The ${label} is too large (64 KB max).`,
    )
    .refine((value) => {
      try {
        z.fromJSONSchema(value as Parameters<typeof z.fromJSONSchema>[0]);
        return true;
      } catch {
        return false;
      }
    }, `The ${label} is not valid JSON Schema.`)
    .refine(
      (value) => !unenforcedKeyword(value),
      "`contains`, `minContains` and `maxContains` are not enforced. Use `prefixItems` or an `items` enum instead.",
    );
}

/** A JSON Schema object that the model's structured output must satisfy. */
export const outputSchemaSchema = jsonObjectSchema("output schema").refine(
  (value) => !(value.properties && typeof value.properties === "object" && "document" in value.properties),
  '`document` is reserved. Turn on "Can propose article changes" instead.',
);

export const mcpToolRefSchema = z.object({ serverId: z.string().min(1), tool: z.string().min(1).max(128) }).strict();
export type McpToolRef = z.infer<typeof mcpToolRefSchema>;

/** Custom tool attached to an agent with that agent's input values. A secret value of null keeps the stored one. */
export const agentToolInputSchema = z
  .object({
    toolId: z.string().min(1),
    inputs: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), z.string().max(4000).nullable()),
  })
  .strict();
export type AgentToolInput = z.infer<typeof agentToolInputSchema>;
/** Browser-safe attachment: non-secret values, and the ids of secret fields that have a stored value. */
export type AgentToolAttachment = { toolId: string; inputs: Record<string, string>; savedSecrets: string[] };

/** An agent's values for a connection's inputs, shared by the connection's endpoints the agent enables. */
export const agentConnectionInputSchema = z
  .object({
    connectionId: z.string().min(1),
    inputs: agentToolInputSchema.shape.inputs,
  })
  .strict();
export type AgentConnectionInput = z.infer<typeof agentConnectionInputSchema>;
export type AgentConnectionAttachment = {
  connectionId: string;
  inputs: Record<string, string>;
  savedSecrets: string[];
};

export const subagentsSchema = z
  .object({
    mode: z.enum(SUBAGENT_MODES),
    /** Agent ids. Delegate: each becomes a callable tool. Pipeline: run in order, output feeds the next. */
    agentIds: z.array(z.string().min(1)).max(MAX_PIPELINE_STEPS),
  })
  .strict()
  .refine((v) => v.mode === "none" || v.agentIds.length > 0, "Choose at least one subagent.")
  .refine((v) => new Set(v.agentIds).size === v.agentIds.length || v.mode === "pipeline", "Subagents repeat.");

export const agentInputSchema = z
  .object({
    key,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    /** Slash command without the slash, e.g. "plan". Unique per section. */
    command: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .nullable(),
    aliases: z.array(z.string().trim().min(1).max(32)).max(10),
    /** The agent's role and instructions (markdown). */
    persona: z.string().trim().min(1).max(40_000),
    /** Provider model id; null uses the platform default. */
    model: z.string().trim().max(120).nullable(),
    effort: z.enum(AI_EFFORTS),
    sections: z.array(z.enum(AGENT_SECTIONS)).max(AGENT_SECTIONS.length),
    /** Sections where this agent is the default (must also be listed in sections). */
    defaultFor: z.array(z.enum(AGENT_SECTIONS)).max(AGENT_SECTIONS.length),
    /** Null = free text answer. */
    outputSchema: outputSchemaSchema.nullable(),
    /** Adds the reserved `document` output (full article proposal) that the editor can preview and apply. */
    proposesDocument: z.boolean(),
    /** The agent cannot run unless the section supplies the current document. */
    requiresDocument: z.boolean(),
    webSearch: z.boolean(),
    builtinTools: z.array(z.enum(BUILTIN_TOOLS)).max(BUILTIN_TOOLS.length),
    skillIds: z.array(z.string().min(1)).max(50),
    mcpTools: z.array(mcpToolRefSchema).max(100),
    subagents: subagentsSchema,
    customTools: z
      .array(agentToolInputSchema)
      .max(100)
      .refine((list) => new Set(list.map((t) => t.toolId)).size === list.length, "A custom tool is attached twice.")
      .default([]),
    connections: z
      .array(agentConnectionInputSchema)
      .max(20)
      .refine(
        (list) => new Set(list.map((c) => c.connectionId)).size === list.length,
        "A connection is attached twice.",
      )
      .default([]),
    enabled: z.boolean(),
  })
  .strict()
  .refine((v) => v.defaultFor.every((s) => v.sections.includes(s)), {
    path: ["defaultFor"],
    message: "A default section must also be an available section.",
  });
export type AgentInput = z.infer<typeof agentInputSchema>;
export type Agent = Omit<AgentInput, "customTools" | "connections"> & {
  customTools: AgentToolAttachment[];
  connections: AgentConnectionAttachment[];
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};

export const skillInputSchema = z
  .object({
    key,
    name: z.string().trim().min(1).max(80),
    /** Shown to the model in the skill index; decides when it loads the body. */
    description: z.string().trim().min(1).max(300),
    /** Full instructions, loaded on demand through the load_skill tool. */
    body: z.string().trim().min(1).max(60_000),
  })
  .strict();
export type SkillInput = z.infer<typeof skillInputSchema>;
export type Skill = SkillInput & { id: string; updatedAt: string };

export const MCP_TRANSPORTS = ["http", "sse"] as const;
export const mcpServerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .refine((value) => {
        const parsed = new URL(value);
        return !parsed.search && !parsed.hash;
      }, "Put credentials in headers, not the URL."),
    transport: z.enum(MCP_TRANSPORTS),
    /**
     * Header name → value. On update, a value of null keeps the stored secret; omitted headers are removed.
     * Values are encrypted at rest and never returned to the browser.
     */
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(4000).nullable()),
    enabled: z.boolean(),
  })
  .strict();
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;
export type McpToolInfo = { name: string; description: string };
/** Browser-safe view: header names only. */
export type McpServer = Omit<McpServerInput, "headers"> & {
  id: string;
  headerNames: string[];
  tools: McpToolInfo[];
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

/** Public metadata a section's agent picker needs. No persona or prompts. */
export type AgentSummary = Pick<
  Agent,
  "id" | "key" | "name" | "description" | "command" | "aliases" | "effort" | "requiresDocument" | "proposesDocument"
> & { isDefault: boolean };
