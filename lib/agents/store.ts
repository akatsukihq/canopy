import "server-only";

import {
  and,
  aiAgentConnectionsTable,
  aiAgentsTable,
  aiAgentToolsTable,
  aiToolConnectionsTable,
  aiMcpServersTable,
  aiSkillsTable,
  aiToolsTable,
  asc,
  db,
  eq,
  inArray,
  sql,
} from "@/db/index.ts";
import { decryptSecret, encryptSecret } from "@/lib/config/secrets.ts";
import {
  MAX_AGENT_DEPTH,
  type Agent,
  type AgentInput,
  type AgentSection,
  type AgentConnectionAttachment,
  type AgentConnectionInput,
  type AgentSummary,
  type AgentToolAttachment,
  type AgentToolInput,
  type McpServer,
  type McpServerInput,
  type McpToolInfo,
  type Skill,
  type SkillInput,
} from "./types.ts";
import type { AgentRuntime } from "./compile.ts";
import type { McpServerRuntime } from "./mcp.ts";
import {
  approvalInGenerationError,
  decodeAttachmentInputs,
  decodeSharedSecrets,
  encodeAttachmentInputs,
  publicAttachment,
  publicInputs,
} from "./toolAttachments.ts";
import { bindConnection, type ToolConnection } from "./toolConnections.ts";
import type { CustomToolRuntime } from "./toolRuntime.ts";
import type { CustomTool } from "./toolTypes.ts";

/** A message written for the admin editor; the only error text actions return to the browser. */
export class AgentConfigError extends Error {
  override name = "AgentConfigError";
}

const STALE_AGENT = "This agent changed since you opened it. Reload and try again.";

const MCP_ADDRESS_CHANGED = "Re-enter header values when you change the server address.";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AgentRow = typeof aiAgentsTable.$inferSelect;
type SkillRow = typeof aiSkillsTable.$inferSelect;
type McpRow = typeof aiMcpServersTable.$inferSelect;
type ToolRow = typeof aiToolsTable.$inferSelect;
type AttachmentRow = typeof aiAgentToolsTable.$inferSelect;
type ConnectionRow = typeof aiToolConnectionsTable.$inferSelect;
type ConnectionAttachmentRow = typeof aiAgentConnectionsTable.$inferSelect;

/** jsonb columns hold values validated by toolInputSchema on every write. */
export function toTool(row: ToolRow): CustomTool {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    kind: row.kind,
    argsSchema: row.argsSchema,
    inputs: row.inputs as CustomTool["inputs"],
    http: row.http as CustomTool["http"],
    code: row.code as CustomTool["code"],
    output: row.output as CustomTool["output"],
    requiresApproval: row.requiresApproval,
    enabled: row.enabled,
    connectionId: row.connectionId,
    savedSecretValues: Object.keys(row.secretValues),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** jsonb columns hold values validated by toolConnectionInputSchema on every write. */
export function toConnection(row: ConnectionRow): ToolConnection {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    inputs: row.inputs as ToolConnection["inputs"],
    headers: row.headers,
    enabled: row.enabled,
    savedSecretValues: Object.keys(row.secretValues),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function groupAttachments(rows: AttachmentRow[]): Map<string, AgentToolAttachment[]> {
  const byAgent = new Map<string, AgentToolAttachment[]>();
  for (const row of rows)
    byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), publicAttachment(row.toolId, row.inputs)]);
  return byAgent;
}

function groupConnections(rows: ConnectionAttachmentRow[]): Map<string, AgentConnectionAttachment[]> {
  const byAgent = new Map<string, AgentConnectionAttachment[]>();
  for (const row of rows)
    byAgent.set(row.agentId, [
      ...(byAgent.get(row.agentId) ?? []),
      { connectionId: row.connectionId, ...publicInputs(row.inputs) },
    ]);
  return byAgent;
}

function toAgent(
  row: AgentRow,
  customTools: AgentToolAttachment[] = [],
  connections: AgentConnectionAttachment[] = [],
): Agent {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    command: row.command,
    aliases: row.aliases,
    persona: row.persona,
    model: row.model,
    effort: row.effort as Agent["effort"],
    sections: row.sections as Agent["sections"],
    defaultFor: row.defaultFor as Agent["defaultFor"],
    outputSchema: row.outputSchema,
    proposesDocument: row.proposesDocument,
    requiresDocument: row.requiresDocument,
    webSearch: row.webSearch,
    builtinTools: row.builtinTools as Agent["builtinTools"],
    skillIds: row.skillIds,
    mcpTools: row.mcpTools,
    subagents: row.subagents,
    customTools,
    connections,
    enabled: row.enabled,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function toSkill(row: SkillRow): Skill {
  const { createdAt: _createdAt, updatedAt, ...rest } = row;
  return { ...rest, updatedAt: updatedAt.toISOString() };
}

function toMcpServer(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    enabled: row.enabled,
    headerNames: Object.keys(row.headers).sort(),
    tools: row.tools,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function agentColumns(input: AgentInput) {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    command: input.command,
    aliases: input.aliases,
    persona: input.persona,
    model: input.model,
    effort: input.effort,
    sections: input.sections,
    defaultFor: input.defaultFor,
    outputSchema: input.outputSchema,
    proposesDocument: input.proposesDocument,
    requiresDocument: input.requiresDocument,
    webSearch: input.webSearch,
    builtinTools: input.builtinTools,
    skillIds: input.skillIds,
    mcpTools: input.mcpTools,
    subagents: input.subagents,
    enabled: input.enabled,
  };
}

/** Pure graph checks. `all` is the stored set; the candidate replaces `agentId` (or is added when null). */
export function validateAgentGraph(agentId: string | null, input: AgentInput, all: Agent[]): void {
  const candidateId = agentId ?? "\u0000new";
  const byId = new Map<string, Pick<AgentInput, "subagents" | "enabled" | "name" | "command" | "sections">>();
  for (const agent of all) if (agent.id !== agentId) byId.set(agent.id, agent);
  byId.set(candidateId, input);

  if (agentId && !input.enabled) {
    const users = all.filter((a) => a.id !== agentId && a.enabled && a.subagents.agentIds.includes(agentId));
    if (users.length)
      throw new AgentConfigError(
        `Used as a subagent by ${users.map((a) => a.name).join(", ")}. Remove it there before turning it off.`,
      );
  }

  for (const id of input.subagents.agentIds) {
    if (id === candidateId) throw new AgentConfigError("An agent cannot be its own subagent.");
    const sub = byId.get(id);
    if (!sub) throw new AgentConfigError("A selected subagent no longer exists.");
    if (!sub.enabled) throw new AgentConfigError(`Subagent "${sub.name}" is turned off. Turn it on or remove it.`);
  }

  // Longest chain (in edges) from each agent; a revisit while on the stack is a cycle.
  const depths = new Map<string, number>();
  const onStack = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (onStack.has(id)) throw new AgentConfigError("These subagents would call each other in a loop.");
    onStack.add(id);
    let depth = 0;
    for (const child of byId.get(id)?.subagents.agentIds ?? [])
      if (byId.has(child)) depth = Math.max(depth, 1 + depthOf(child));
    onStack.delete(id);
    depths.set(id, depth);
    return depth;
  };
  for (const id of byId.keys()) {
    if (depthOf(id) > MAX_AGENT_DEPTH)
      throw new AgentConfigError(`Subagents can be nested at most ${MAX_AGENT_DEPTH} levels deep.`);
  }

  if (input.enabled && input.command) {
    for (const [id, other] of byId) {
      if (id === candidateId || !other.enabled || other.command !== input.command) continue;
      const shared = other.sections.find((s) => input.sections.includes(s));
      if (shared)
        throw new AgentConfigError(`Command /${input.command} is already used by "${other.name}" in the same section.`);
    }
  }
}

/** Serializes every write to the agent graph (agents, skills, MCP servers, tools) so checks and writes can't interleave. */
export async function lockGraph(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai_agents_graph'))`);
}

async function listAgentsIn(tx: Tx | typeof db): Promise<Agent[]> {
  const rows = await tx.select().from(aiAgentsTable).orderBy(asc(aiAgentsTable.name));
  const byAgent = groupAttachments(await tx.select().from(aiAgentToolsTable));
  const connections = groupConnections(await tx.select().from(aiAgentConnectionsTable));
  return rows.map((row) => toAgent(row, byAgent.get(row.id), connections.get(row.id)));
}

/** Rejects an approval-required tool reachable from a blog-generation agent. Run after the write, inside the lock. */
export async function assertApprovalRule(tx: Tx): Promise<void> {
  const approval = await tx
    .select({ id: aiToolsTable.id, name: aiToolsTable.name })
    .from(aiToolsTable)
    .where(eq(aiToolsTable.requiresApproval, true));
  if (!approval.length) return;
  const agents = (await listAgentsIn(tx)).map((agent) => ({
    ...agent,
    toolIds: agent.customTools.map((tool) => tool.toolId),
  }));
  const error = approvalInGenerationError(agents, new Map(approval.map((tool) => [tool.id, tool.name])));
  if (error) throw new AgentConfigError(error);
}

/**
 * Replaces the agent's connection values. Every attached endpoint needs its connection's values, and values for a
 * connection with no attached endpoint are rejected.
 */
async function saveConnectionAttachments(
  tx: Tx,
  agentId: string,
  list: AgentConnectionInput[],
  tools: CustomTool[],
): Promise<void> {
  const needed = new Set(tools.flatMap((tool) => (tool.connectionId ? [tool.connectionId] : [])));
  const ids = list.map((entry) => entry.connectionId);
  const connections = ids.length
    ? (await tx.select().from(aiToolConnectionsTable).where(inArray(aiToolConnectionsTable.id, ids))).map(toConnection)
    : [];
  const stored = new Map(
    (await tx.select().from(aiAgentConnectionsTable).where(eq(aiAgentConnectionsTable.agentId, agentId))).map((row) => [
      row.connectionId,
      row.inputs,
    ]),
  );
  const values = list.map((entry) => {
    const connection = connections.find((candidate) => candidate.id === entry.connectionId);
    if (!connection) throw new AgentConfigError("A selected connection no longer exists.");
    if (!needed.has(connection.id))
      throw new AgentConfigError(`Enable at least one "${connection.name}" endpoint, or remove the connection.`);
    needed.delete(connection.id);
    const encoded = encodeAttachmentInputs(agentId, connection, entry.inputs, stored.get(connection.id), "conn");
    if (!encoded.ok) throw new AgentConfigError(encoded.error);
    return { agentId, connectionId: connection.id, inputs: encoded.value };
  });
  if (needed.size) throw new AgentConfigError("Fill in the connection for every endpoint you enable.");
  await tx.delete(aiAgentConnectionsTable).where(eq(aiAgentConnectionsTable.agentId, agentId));
  if (values.length) await tx.insert(aiAgentConnectionsTable).values(values);
}

/** Replaces the agent's tool attachments. Secrets of null keep their stored value. */
async function saveAttachments(
  tx: Tx,
  agentId: string,
  list: AgentToolInput[],
  connections: AgentConnectionInput[],
): Promise<void> {
  const ids = list.map((entry) => entry.toolId);
  const tools = ids.length
    ? (await tx.select().from(aiToolsTable).where(inArray(aiToolsTable.id, ids))).map(toTool)
    : [];
  const stored = new Map(
    (await tx.select().from(aiAgentToolsTable).where(eq(aiAgentToolsTable.agentId, agentId))).map((row) => [
      row.toolId,
      row.inputs,
    ]),
  );
  const values = list.map((entry) => {
    const tool = tools.find((candidate) => candidate.id === entry.toolId);
    if (!tool) throw new AgentConfigError("A selected custom tool no longer exists.");
    const encoded = encodeAttachmentInputs(agentId, tool, entry.inputs, stored.get(tool.id));
    if (!encoded.ok) throw new AgentConfigError(encoded.error);
    return { agentId, toolId: tool.id, inputs: encoded.value };
  });
  await saveConnectionAttachments(tx, agentId, connections, tools);
  await tx.delete(aiAgentToolsTable).where(eq(aiAgentToolsTable.agentId, agentId));
  if (values.length) await tx.insert(aiAgentToolsTable).values(values);
  await assertApprovalRule(tx);
}

async function assertReferencesExist(tx: Tx, input: AgentInput): Promise<void> {
  if (input.skillIds.length) {
    const rows = await tx
      .select({ id: aiSkillsTable.id })
      .from(aiSkillsTable)
      .where(inArray(aiSkillsTable.id, input.skillIds));
    if (rows.length !== new Set(input.skillIds).size) throw new AgentConfigError("A selected skill no longer exists.");
  }
  const serverIds = [...new Set(input.mcpTools.map((t) => t.serverId))];
  if (serverIds.length) {
    const rows = await tx
      .select({ id: aiMcpServersTable.id })
      .from(aiMcpServersTable)
      .where(inArray(aiMcpServersTable.id, serverIds));
    if (rows.length !== serverIds.length) throw new AgentConfigError("A selected MCP server no longer exists.");
  }
}

/** Clears the sections this agent now defaults, on every other agent. */
async function clearOtherDefaults(tx: Tx, agentId: string, sections: string[]): Promise<void> {
  if (!sections.length) return;
  const rows = await tx.select().from(aiAgentsTable);
  for (const row of rows) {
    if (row.id === agentId || !row.defaultFor.some((s) => sections.includes(s))) continue;
    await tx
      .update(aiAgentsTable)
      .set({
        defaultFor: row.defaultFor.filter((s) => !sections.includes(s)),
        version: sql`${aiAgentsTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(aiAgentsTable.id, row.id));
  }
}

/** Stored header secrets must not follow a changed origin to a new host. */
export function assertHeadersAllowedForUrl(
  currentUrl: string,
  nextUrl: string,
  headers: Record<string, string | null>,
): void {
  if (new URL(nextUrl).origin === new URL(currentUrl).origin) return;
  if (Object.values(headers).some((value) => value === null)) throw new AgentConfigError(MCP_ADDRESS_CHANGED);
}

/** Maps an MCP connection failure to a fixed, admin-safe message. Never echoes raw error text. */
export function describeMcpFailure(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  const status = /\b(?:HTTP|status(?: code)?)\s*:?\s*(\d{3})\b/i.exec(text)?.[1];
  if (status === "401" || status === "403" || /unauthori[sz]ed|forbidden/i.test(text))
    return "The server rejected the credentials. Check the header values and save the server again.";
  if (status) return `The server answered with HTTP ${status}. Check the address and that the server is running.`;
  if (/private|public (?:https )?address|blocked|not allowed/i.test(text))
    return "The address is blocked because it is not a public server. Use a public https address.";
  if (/timeout|timed out|abort/i.test(text))
    return "The server did not answer in time. Try again, or check that it is running.";
  if (/resolved|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|unreachable|network/i.test(text))
    return "The server could not be reached. Check the address and that it is online.";
  if (/invalid|unexpected|parse|json|schema|protocol|malformed/i.test(text))
    return "The server sent a response that is not valid MCP. Check that the address points to an MCP endpoint.";
  return "The server could not be reached. Check the address and credentials, then try again.";
}

export function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string; cause?: { code?: string } })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function listAgents(): Promise<Agent[]> {
  return listAgentsIn(db);
}

async function withAttachments(tx: Tx | typeof db, row: AgentRow): Promise<Agent> {
  const attachments = await tx.select().from(aiAgentToolsTable).where(eq(aiAgentToolsTable.agentId, row.id));
  const connections = await tx
    .select()
    .from(aiAgentConnectionsTable)
    .where(eq(aiAgentConnectionsTable.agentId, row.id));
  return toAgent(row, groupAttachments(attachments).get(row.id), groupConnections(connections).get(row.id));
}

export async function getAgent(id: string): Promise<Agent | null> {
  const [row] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, id)).limit(1);
  return row ? withAttachments(db, row) : null;
}

export async function createAgent(input: AgentInput, actor: string): Promise<Agent> {
  const id = crypto.randomUUID();
  try {
    return await db.transaction(async (tx) => {
      await lockGraph(tx);
      validateAgentGraph(null, input, await listAgentsIn(tx));
      await assertReferencesExist(tx, input);
      await clearOtherDefaults(tx, id, input.defaultFor);
      const [row] = await tx
        .insert(aiAgentsTable)
        .values({ id, ...agentColumns(input), updatedBy: actor })
        .returning();
      await saveAttachments(tx, id, input.customTools, input.connections);
      return withAttachments(tx, row);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AgentConfigError(`The key "${input.key}" is already used by another agent.`);
    throw error;
  }
}

export async function updateAgent(
  id: string,
  input: AgentInput,
  expectedVersion: number,
  actor: string,
): Promise<Agent> {
  try {
    return await db.transaction(async (tx) => {
      await lockGraph(tx);
      validateAgentGraph(id, input, await listAgentsIn(tx));
      await assertReferencesExist(tx, input);
      await clearOtherDefaults(tx, id, input.defaultFor);
      const [row] = await tx
        .update(aiAgentsTable)
        .set({ ...agentColumns(input), version: expectedVersion + 1, updatedBy: actor, updatedAt: new Date() })
        .where(and(eq(aiAgentsTable.id, id), eq(aiAgentsTable.version, expectedVersion)))
        .returning();
      if (!row) {
        const [exists] = await tx
          .select({ id: aiAgentsTable.id })
          .from(aiAgentsTable)
          .where(eq(aiAgentsTable.id, id))
          .limit(1);
        throw new AgentConfigError(exists ? STALE_AGENT : "This agent no longer exists.");
      }
      await saveAttachments(tx, id, input.customTools, input.connections);
      return withAttachments(tx, row);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AgentConfigError(`The key "${input.key}" is already used by another agent.`);
    throw error;
  }
}

export async function deleteAgent(id: string, _actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGraph(tx);
    const users = (await listAgentsIn(tx)).filter((a) => a.id !== id && a.subagents.agentIds.includes(id));
    if (users.length)
      throw new AgentConfigError(
        `Used as a subagent by ${users.map((a) => a.name).join(", ")}. Remove it there first.`,
      );
    await tx.delete(aiAgentsTable).where(eq(aiAgentsTable.id, id));
  });
}

export async function listSkills(): Promise<Skill[]> {
  return (await db.select().from(aiSkillsTable).orderBy(asc(aiSkillsTable.name))).map(toSkill);
}

export async function getSkill(id: string): Promise<Skill | null> {
  const [row] = await db.select().from(aiSkillsTable).where(eq(aiSkillsTable.id, id)).limit(1);
  return row ? toSkill(row) : null;
}

export async function createSkill(input: SkillInput): Promise<Skill> {
  try {
    const [row] = await db
      .insert(aiSkillsTable)
      .values({ id: crypto.randomUUID(), ...input })
      .returning();
    return toSkill(row);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AgentConfigError(`The key "${input.key}" is already used by another skill.`);
    throw error;
  }
}

export async function updateSkill(id: string, input: SkillInput): Promise<Skill> {
  try {
    const [row] = await db
      .update(aiSkillsTable)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(aiSkillsTable.id, id))
      .returning();
    if (!row) throw new AgentConfigError("This skill no longer exists.");
    return toSkill(row);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AgentConfigError(`The key "${input.key}" is already used by another skill.`);
    throw error;
  }
}

export async function deleteSkill(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGraph(tx);
    const users = (await listAgentsIn(tx)).filter((a) => a.skillIds.includes(id));
    if (users.length)
      throw new AgentConfigError(`Attached to ${users.map((a) => a.name).join(", ")}. Detach it there first.`);
    await tx.delete(aiSkillsTable).where(eq(aiSkillsTable.id, id));
  });
}

const headerAad = (serverId: string, header: string) => `mcp:${serverId}:${header}`;

export async function listMcpServers(): Promise<McpServer[]> {
  return (await db.select().from(aiMcpServersTable).orderBy(asc(aiMcpServersTable.name))).map(toMcpServer);
}

async function assertMcpNameFree(tx: Tx, name: string, exceptId: string | null): Promise<void> {
  const rows = await tx.select({ id: aiMcpServersTable.id, name: aiMcpServersTable.name }).from(aiMcpServersTable);
  const taken = rows.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (taken) throw new AgentConfigError(`An MCP server named "${name}" already exists. Choose another name.`);
}

export async function createMcpServer(input: McpServerInput): Promise<McpServer> {
  const id = crypto.randomUUID();
  const headers: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === null) throw new AgentConfigError(`Header ${name} needs a value.`);
    headers[name] = encryptSecret(value, headerAad(id, name));
  }
  return db.transaction(async (tx) => {
    await lockGraph(tx);
    await assertMcpNameFree(tx, input.name, null);
    const [row] = await tx
      .insert(aiMcpServersTable)
      .values({ id, name: input.name, url: input.url, transport: input.transport, enabled: input.enabled, headers })
      .returning();
    return toMcpServer(row);
  });
}

export async function updateMcpServer(id: string, input: McpServerInput): Promise<McpServer> {
  return db.transaction(async (tx) => {
    await lockGraph(tx);
    const [current] = await tx.select().from(aiMcpServersTable).where(eq(aiMcpServersTable.id, id)).limit(1);
    if (!current) throw new AgentConfigError("This MCP server no longer exists.");
    assertHeadersAllowedForUrl(current.url, input.url, input.headers);
    await assertMcpNameFree(tx, input.name, id);
    const headers: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      if (value === null) {
        if (!(name in current.headers)) throw new AgentConfigError(`Header ${name} has no saved value. Enter one.`);
        headers[name] = current.headers[name];
      } else headers[name] = encryptSecret(value, headerAad(id, name));
    }
    const [row] = await tx
      .update(aiMcpServersTable)
      .set({
        name: input.name,
        url: input.url,
        transport: input.transport,
        enabled: input.enabled,
        headers,
        updatedAt: new Date(),
      })
      .where(eq(aiMcpServersTable.id, id))
      .returning();
    return toMcpServer(row);
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGraph(tx);
    const users = (await listAgentsIn(tx)).filter((a) => a.mcpTools.some((t) => t.serverId === id));
    if (users.length)
      throw new AgentConfigError(`Used by ${users.map((a) => a.name).join(", ")}. Remove its tools there first.`);
    await tx.delete(aiMcpServersTable).where(eq(aiMcpServersTable.id, id));
  });
}

export async function saveMcpToolCache(id: string, tools: McpToolInfo[] | null, error: string | null): Promise<void> {
  await db
    .update(aiMcpServersTable)
    .set({ ...(tools ? { tools } : {}), lastError: error, lastCheckedAt: new Date() })
    .where(eq(aiMcpServersTable.id, id));
}

/** Enabled agents for a section, ordered by name. */
export async function listSectionAgents(section: AgentSection): Promise<AgentSummary[]> {
  return (await listAgents())
    .filter((a) => a.enabled && a.sections.includes(section))
    .map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      command: a.command,
      aliases: a.aliases,
      effort: a.effort,
      requiresDocument: a.requiresDocument,
      proposesDocument: a.proposesDocument,
      isDefault: a.defaultFor.includes(section),
    }));
}

/** Matches id, key or command; omitted returns the section default, else the first by name. */
export async function getSectionAgent(section: AgentSection, idOrCommand?: string): Promise<Agent | null> {
  const agents = (await listAgents()).filter((a) => a.enabled && a.sections.includes(section));
  if (idOrCommand)
    return agents.find((a) => a.id === idOrCommand || a.key === idOrCommand || a.command === idOrCommand) ?? null;
  return agents.find((a) => a.defaultFor.includes(section)) ?? agents[0] ?? null;
}

function toMcpRuntime(row: McpRow): McpServerRuntime {
  const headers: Record<string, string> = {};
  for (const [name, stored] of Object.entries(row.headers)) {
    const value = decryptSecret(stored, headerAad(row.id, name));
    if (value === null)
      throw new AgentConfigError(
        `MCP server "${row.name}": header ${name} could not be decrypted. Re-enter it in Admin.`,
      );
    headers[name] = value;
  }
  return { id: row.id, name: row.name, url: row.url, transport: row.transport, headers, tools: row.tools };
}

/** One server with decrypted headers, enabled or not (used to refresh its tool list). */
export async function loadMcpServerRuntime(id: string): Promise<McpServerRuntime> {
  const [row] = await db.select().from(aiMcpServersTable).where(eq(aiMcpServersTable.id, id)).limit(1);
  if (!row) throw new AgentConfigError("This MCP server no longer exists.");
  return toMcpRuntime(row);
}

export async function loadAgentRuntime(agentId: string): Promise<AgentRuntime> {
  const all = new Map((await listAgents()).map((a) => [a.id, a]));
  const root = all.get(agentId);
  if (!root) throw new AgentConfigError("This agent no longer exists.");

  const agents: Record<string, Agent> = {};
  const queue = [root];
  for (let agent = queue.pop(); agent; agent = queue.pop()) {
    if (agents[agent.id]) continue; // cycle guard
    agents[agent.id] = agent;
    for (const id of agent.subagents.agentIds) {
      const sub = all.get(id);
      if (!sub) continue;
      if (!sub.enabled) throw new AgentConfigError(`Subagent "${sub.name}" is turned off. Turn it on or remove it.`);
      queue.push(sub);
    }
  }

  const skillIds = [...new Set(Object.values(agents).flatMap((a) => a.skillIds))];
  const skillRows = skillIds.length
    ? await db.select().from(aiSkillsTable).where(inArray(aiSkillsTable.id, skillIds))
    : [];
  const skills = Object.fromEntries(skillRows.map((row) => [row.id, toSkill(row)]));

  const serverIds = [...new Set(Object.values(agents).flatMap((a) => a.mcpTools.map((t) => t.serverId)))];
  const serverRows = serverIds.length
    ? await db.select().from(aiMcpServersTable).where(inArray(aiMcpServersTable.id, serverIds))
    : [];
  const mcpServers: Record<string, McpServerRuntime> = {};
  for (const row of serverRows) if (row.enabled) mcpServers[row.id] = toMcpRuntime(row);

  return { agent: root, agents, skills, mcpServers, customTools: await loadCustomTools(Object.keys(agents)) };
}

/** Enabled attached tools per agent, with decrypted inputs. Endpoints are bound to their connection. */
async function loadCustomTools(agentIds: string[]): Promise<Record<string, CustomToolRuntime[]>> {
  const rows = await db.select().from(aiAgentToolsTable).where(inArray(aiAgentToolsTable.agentId, agentIds));
  const toolIds = [...new Set(rows.map((row) => row.toolId))];
  if (!toolIds.length) return {};
  const toolRows = await db.select().from(aiToolsTable).where(inArray(aiToolsTable.id, toolIds));
  const tools = new Map(toolRows.map((row) => [row.id, toTool(row)]));
  const sharedOf = new Map<string, Record<string, unknown>>(
    toolRows.map((row) => [`tool:${row.id}`, row.secretValues]),
  );
  const connectionIds = [...new Set([...tools.values()].flatMap((tool) => tool.connectionId ?? []))];
  const connectionRows = connectionIds.length
    ? await db.select().from(aiToolConnectionsTable).where(inArray(aiToolConnectionsTable.id, connectionIds))
    : [];
  const connections = new Map(connectionRows.map((row) => [row.id, toConnection(row)]));
  for (const row of connectionRows) sharedOf.set(`conn:${row.id}`, row.secretValues);
  const connectionValues = new Map(
    connectionIds.length
      ? (await db.select().from(aiAgentConnectionsTable).where(inArray(aiAgentConnectionsTable.agentId, agentIds))).map(
          (row) => [`${row.agentId}:${row.connectionId}`, row.inputs],
        )
      : [],
  );
  const byAgent: Record<string, CustomToolRuntime[]> = {};
  for (const row of rows) {
    const saved = tools.get(row.toolId);
    const connection = saved?.connectionId ? connections.get(saved.connectionId) : undefined;
    if (saved?.connectionId && !connection) continue;
    const tool = saved && connection ? bindConnection(saved, connection) : saved;
    if (!tool?.enabled) continue;
    const owner = connection ?? tool;
    const scope = connection ? "conn" : "tool";
    const shared = decodeSharedSecrets(scope, owner, sharedOf.get(`${scope}:${owner.id}`) ?? {});
    if (!shared.ok) throw new AgentConfigError(shared.error);
    const own = connection
      ? decodeAttachmentInputs(
          row.agentId,
          connection,
          connectionValues.get(`${row.agentId}:${connection.id}`) ?? {},
          "conn",
        )
      : decodeAttachmentInputs(row.agentId, tool, row.inputs);
    // An agent's own value overrides the shared one.
    const inputs = own.ok ? { ok: true as const, value: { ...shared.value, ...own.value } } : own;
    if (!inputs.ok) throw new AgentConfigError(inputs.error);
    byAgent[row.agentId] = [...(byAgent[row.agentId] ?? []), { tool, inputs: inputs.value }];
  }
  return byAgent;
}
