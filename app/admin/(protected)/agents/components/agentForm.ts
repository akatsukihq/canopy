import { agentInputSchema, type Agent, type AgentInput } from "@/lib/agents/types.ts";

/** Editable form state: text-friendly stand-ins for aliases, model, command and the output schema. */
export type AgentForm = Omit<AgentInput, "aliases" | "model" | "command" | "outputSchema"> & {
  aliases: string;
  model: string;
  command: string;
  outputMode: "text" | "structured";
  schemaText: string;
};

export const DEFAULT_SCHEMA_TEXT = JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2);

export function emptyAgentForm(): AgentForm {
  return {
    key: "",
    name: "",
    description: "",
    command: "",
    aliases: "",
    persona: "",
    model: "",
    effort: "medium",
    sections: [],
    defaultFor: [],
    outputMode: "text",
    schemaText: DEFAULT_SCHEMA_TEXT,
    proposesDocument: false,
    requiresDocument: false,
    webSearch: false,
    builtinTools: [],
    skillIds: [],
    mcpTools: [],
    subagents: { mode: "none", agentIds: [] },
    customTools: [],
    connections: [],
    enabled: true,
  };
}

export function agentToForm(agent: Agent): AgentForm {
  const { outputSchema, aliases, model, command, customTools, connections, ...rest } = agent;
  return {
    ...emptyAgentForm(),
    ...rest,
    // Saved secrets are null: "keep the stored value".
    customTools: customTools.map(({ toolId, inputs, savedSecrets }) => ({
      toolId,
      inputs: { ...inputs, ...Object.fromEntries(savedSecrets.map((id) => [id, null])) },
    })),
    connections: connections.map(({ connectionId, inputs, savedSecrets }) => ({
      connectionId,
      inputs: { ...inputs, ...Object.fromEntries(savedSecrets.map((id) => [id, null])) },
    })),
    aliases: aliases.join(", "),
    model: model ?? "",
    command: command ?? "",
    outputMode: outputSchema ? "structured" : "text",
    schemaText: outputSchema ? JSON.stringify(outputSchema, null, 2) : DEFAULT_SCHEMA_TEXT,
  };
}

export function schemaTextError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return `This is not valid JSON: ${error instanceof Error ? error.message : "check the syntax"}.`;
  }
}

/** Parses the form into a validated payload, or returns per-field messages. */
export function parseAgentForm(
  form: AgentForm,
): { ok: true; input: AgentInput } | { ok: false; errors: Record<string, string> } {
  let outputSchema: Record<string, unknown> | null = null;
  const errors: Record<string, string> = {};
  if (form.outputMode === "structured") {
    const jsonError = schemaTextError(form.schemaText);
    if (jsonError) errors.outputSchema = jsonError;
    else outputSchema = JSON.parse(form.schemaText);
  }
  const { aliases, model, command, outputMode: _mode, schemaText: _text, ...rest } = form;
  const parsed = agentInputSchema.safeParse({
    ...rest,
    aliases: aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean),
    model: model.trim() || null,
    command: command.trim() || null,
    outputSchema,
    // Only meaningful when an article is proposed or required.
    defaultFor: rest.defaultFor.filter((section) => rest.sections.includes(section)),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      errors[field] ??= issue.message;
    }
  }
  return Object.keys(errors).length || !parsed.success ? { ok: false, errors } : { ok: true, input: parsed.data };
}

export function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? (list.includes(item) ? [...list] : [...list, item]) : list.filter((entry) => entry !== item);
}
