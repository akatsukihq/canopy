/** Seeded-like admin-configured agents for section tests (shape of lib/agents/types.ts Agent). */

const text = (maxLength) => ({ type: "string", maxLength });
const list = (items) => ({ type: "array", maxItems: 50, items });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** A report schema shaped like the seeded blog editor ones (the seed's planner also fixes its section headings). */
export const REPORT_SCHEMA = object({
  label: text(160),
  summary: text(2000),
  sections: list(
    object({
      heading: text(200),
      text: text(12000),
      items: list(text(3000)),
      findings: list(
        object({
          severity: { type: "string", enum: ["high", "medium", "low"] },
          passage: text(4000),
          issue: text(2000),
          recommendation: text(3000),
        }),
      ),
    }),
  ),
  keywords: list(
    object({
      keyword: text(200),
      kind: { type: "string", enum: ["primary", "secondary", "long-tail"] },
      rationale: text(2000),
    }),
  ),
  searchIntent: text(2000),
  changes: list(text(3000)),
  remainingTasks: list(text(3000)),
});

export function agent(key, overrides = {}) {
  return {
    id: `agent-${key}`,
    key,
    name: key[0].toUpperCase() + key.slice(1),
    description: `Does ${key}`,
    command: key,
    aliases: [],
    persona: `Persona of ${key}`,
    model: null,
    effort: "medium",
    sections: ["blog-editor"],
    defaultFor: [],
    outputSchema: null,
    proposesDocument: false,
    requiresDocument: false,
    webSearch: false,
    builtinTools: [],
    skillIds: [],
    mcpTools: [],
    subagents: { mode: "none", agentIds: [] },
    enabled: true,
    version: 1,
    updatedAt: "2026-11-05T00:00:00Z",
    updatedBy: null,
    ...overrides,
  };
}

/** Planner, auditor (reports) and writer, optimizer (propose a complete draft), as seeded. */
export const BLOG_EDITOR_AGENTS = [
  agent("planner", { outputSchema: REPORT_SCHEMA, defaultFor: ["blog-editor"] }),
  agent("writer", { outputSchema: REPORT_SCHEMA, proposesDocument: true, requiresDocument: true }),
  agent("auditor", { outputSchema: REPORT_SCHEMA, requiresDocument: true, effort: "high" }),
  agent("optimizer", { outputSchema: REPORT_SCHEMA, proposesDocument: true, requiresDocument: true, effort: "high" }),
];
