# AI Agents — design

Admin-configured agents replace the hardcoded blog agents (`lib/blog/agentCatalog.ts`,
`agentRegistry.ts` policies, `agentPersonas.ts`, `generationAgents.ts`). Agents, skills and MCP servers
live in Postgres and are edited in `/admin/agents`. Sections (blog editor, blog generation, tool content)
list the agents enabled for them and run them through the existing assistant run lifecycle
(`lib/assistant/runs.ts`, `AssistantStageRequest`).

## Shared contract (already written — do not change without coordinating)

- `lib/agents/types.ts` — zod input schemas + types: `Agent`, `Skill`, `McpServer`, `AgentSummary`,
  `AGENT_SECTIONS`, `BUILTIN_TOOLS`, `MAX_AGENT_DEPTH` (2), `MAX_PIPELINE_STEPS` (8).
- `db/schema.ts` — `aiAgentsTable`, `aiSkillsTable`, `aiMcpServersTable`.
- `db/migration/0014-ai-agents/0001_ai_agents.sql` — tables.
- `lib/authorization/index.ts` — permission `agents` with actions `view`, `edit`.

## Concepts

- **Persona**: the agent's own markdown role/instructions.
- **Skills (progressive)**: the system prompt contains only an index (`key — description`) of attached
  skills. The agent gets a `load_skill({ key })` tool returning the full body. Only attached skills load.
- **Output**: `outputSchema` (JSON Schema, object root) → structured output via `z.fromJSONSchema`.
  `null` = free text. `proposesDocument` adds reserved property `document`
  (`{ title, excerpt, bodyJson, seoTitle, seoDescription }`, same as today's `proposedDocument` in
  `agentRegistry.ts`) which the blog editor previews/applies with existing protected-content checks.
- **Tools**: `webSearch` flag (provider search), `builtinTools` (code registry, `generate_image` today),
  `mcpTools` (allowlisted `{serverId, tool}` from remote MCP servers).
- **Subagents**: `delegate` — each subagent becomes a tool `delegate_<key>({ task })` returning the
  subagent's final text/output; `pipeline` — run root agent, then each listed agent in order, each
  receiving the previous output as a user message; last output completes the run. Depth ≤ 2, no cycles
  (checked on save and at compile time).
- **Sections**: agent lists `sections` it appears in and `defaultFor`. Section supplies context and
  owns final validation of `document` output.

## Always-on guards (code, not config)

- SAFETY block appended to every system prompt (untrusted data, no fabrication, never claim saved/published).
- MCP: https only; resolve host and reject private/loopback/link-local/metadata IPs before connect and
  on every request; headers encrypted with `lib/config/secrets.ts` (`encryptSecret(value, "mcp:<serverId>:<header>")`);
  headers never sent to the browser; connect timeout 10 s; tool output truncated to 100 KB; clients closed when
  the run ends or aborts.
- `agents:edit` required for writes, `agents:view` for admin reads; section runtime reads need no extra permission
  beyond the section's own.
- Every write records an audit event like other admin mutations.

## Modules

| Module | Owner | Responsibility |
| --- | --- | --- |
| `lib/agents/store.ts` | store | CRUD for agents/skills/MCP servers, validation (incl. subagent cycle/depth, skill/MCP references exist, unique command per section), `listSectionAgents(section)`, `loadAgentRuntime(agentId)` |
| `app/admin/(protected)/agents/actions.ts` | store | Server actions wrapping the store with permission + audit |
| `lib/agents/compile.ts` | runtime | `compileAgent(runtime, input) → AssistantStageRequest` |
| `lib/agents/mcp.ts` | runtime | SSRF-checked MCP client lifecycle, tool listing, tool allowlist |
| `lib/agents/builtinTools.ts` | runtime | Builtin tool registry |
| `app/admin/(protected)/agents/**` UI | ui | List + editor for agents, skills, MCP servers |
| `db/migration/0014-ai-agents/0002_seed_ai_agents.sql` | seed | Seeds current agents + persona blocks as skills |
| section integrations | integration (wave 2) | Blog editor, blog generation, tool content use the store + compiler; delete hardcoded files |

## Interfaces between modules

```ts
// lib/agents/store.ts (server-only)
export type AgentRuntime = {
  agent: Agent;                       // root
  agents: Record<string, Agent>;      // root + every transitive subagent, by id
  skills: Record<string, Skill>;      // every skill attached anywhere in the graph, by id
  mcpServers: Record<string, McpServerRuntime>; // referenced servers, enabled only
};
export type McpServerRuntime = { id: string; name: string; url: string; transport: "http" | "sse"; headers: Record<string, string> }; // decrypted
export function listSectionAgents(section: AgentSection): Promise<AgentSummary[]>;   // enabled only, ordered by name
export function getSectionAgent(section: AgentSection, idOrCommand?: string): Promise<Agent | null>; // default when omitted
export function loadAgentRuntime(agentId: string): Promise<AgentRuntime>;
export function listAgents(): Promise<Agent[]>; getAgent(id); createAgent(input, actor); updateAgent(id, input, expectedVersion, actor); deleteAgent(id, actor);
export function listSkills(); getSkill(id); createSkill(input); updateSkill(id, input); deleteSkill(id);   // delete refused while attached
export function listMcpServers(): Promise<McpServer[]>; createMcpServer(input); updateMcpServer(id, input); deleteMcpServer(id); // delete refused while referenced
export function saveMcpToolCache(id, tools: McpToolInfo[] | null, error: string | null): Promise<void>;
export function validateAgentGraph(agentId: string | null, input: AgentInput, all: Agent[]): void; // pure, throws Error with user-facing message

// lib/agents/mcp.ts (server-only)
export function assertPublicMcpUrl(url: string): Promise<URL>;       // throws on non-https / private address
export function listMcpTools(server: McpServerRuntime, signal?: AbortSignal): Promise<McpToolInfo[]>;
export function openMcpTools(servers: McpServerRuntime[], refs: McpToolRef[], signal: AbortSignal):
  Promise<{ tools: Record<string, AITool>; close(): Promise<void> }>; // tool names `mcp_<server-slug>_<tool>`

// lib/agents/compile.ts (server-only)
export type CompileInput = {
  messages: AIMessage[];          // section-built context (history + user turn), no system message
  sectionRules?: string;          // section-owned instructions appended after persona
  signal: AbortSignal;
  actorUserId: string;
  provider: string;
  reportToolFailure: (toolName: string, error: unknown) => void;
};
export function compileAgent(runtime: AgentRuntime, input: CompileInput): Promise<AssistantStageRequest>;
export function agentOutputZod(agent: Agent): z.ZodType | undefined;  // outputSchema (+ document) → zod
```

## Admin server actions (`app/admin/(protected)/agents/actions.ts`)

All return `{ ok: true, data } | { ok: false, error: string, fieldErrors?: Record<string, string> }`.
`saveAgent(id | null, input, expectedVersion?)`, `deleteAgent(id)`, `saveSkill(id | null, input)`,
`deleteSkill(id)`, `saveMcpServer(id | null, input)`, `deleteMcpServer(id)`, `refreshMcpTools(id)`
(lists tools via `lib/agents/mcp.ts`, saves cache, returns tools or error). Pages read via the store directly
(Server Components) after `requirePagePermission("agents", "view")`.

## Testing

`node:test` tests in `tests/ai-agents-*.test.mjs` for: input validation, graph cycle/depth checks,
MCP URL guard (private IPs, non-https), skill index + load_skill behaviour, delegate/pipeline compilation,
output schema conversion including reserved `document`. No source-text assertions.
