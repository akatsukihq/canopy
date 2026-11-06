/** Server-only storage for custom tool templates and connections. Attachments to agents are saved with the agent (store.ts). */
import "server-only";

import { z } from "zod";
import { aiAgentsTable, aiAgentToolsTable, aiToolConnectionsTable, aiToolsTable, asc, db, eq } from "@/db/index.ts";
import {
  AgentConfigError,
  assertApprovalRule,
  isUniqueViolation,
  lockGraph,
  toConnection,
  toTool,
  type Tx,
} from "./store.ts";
import { decodeSharedSecrets, encodeSharedSecrets } from "./toolAttachments.ts";
import { bindConnection, type ToolConnection, type ToolConnectionInput } from "./toolConnections.ts";
import {
  argumentNames,
  httpTemplateIssues,
  type CustomTool,
  type ToolInput,
  type ToolInputField,
} from "./toolTypes.ts";

function columns(input: ToolInput) {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    kind: input.kind,
    argsSchema: input.argsSchema,
    inputs: input.inputs,
    http: input.http,
    code: input.code,
    output: input.output,
    requiresApproval: input.requiresApproval,
    enabled: input.enabled,
    connectionId: input.connectionId,
  };
}

function connectionColumns(input: ToolConnectionInput) {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    baseUrl: input.baseUrl,
    inputs: input.inputs,
    headers: input.headers,
    enabled: input.enabled,
  };
}

/** Encrypted shared secret values to store; throws the admin-facing message when encryption is unavailable. */
function sharedSecrets(
  scope: "tool" | "conn",
  id: string,
  input: Pick<ToolInput, "inputs" | "secretValues">,
  stored: Record<string, unknown> = {},
): Record<string, unknown> {
  const encoded = encodeSharedSecrets(scope, id, input.inputs, input.secretValues, stored);
  if (!encoded.ok) throw new AgentConfigError(encoded.error);
  return encoded.value;
}

const keyTaken = (key: string) => new AgentConfigError(`The key "${key}" is already used by another custom tool.`);

/** Placeholder problems of an endpoint once bound to its connection, as field errors (prefix e.g. "tools.3"). */
function endpointIssues(
  tool: Omit<ToolInput, "secretValues">,
  connection: Omit<ToolConnectionInput, "secretValues">,
  prefix: (string | number)[] = [],
) {
  const bound = bindConnection(tool, connection);
  if (!bound.http) return [];
  return httpTemplateIssues(bound.http, argumentNames(bound.argsSchema), bound.inputs).map((issue) => ({
    code: "custom" as const,
    path: [...prefix, ...issue.path],
    message: issue.message,
    input: undefined,
  }));
}

async function loadConnection(tx: Tx | typeof db, id: string): Promise<ToolConnection> {
  const [row] = await tx.select().from(aiToolConnectionsTable).where(eq(aiToolConnectionsTable.id, id)).limit(1);
  if (!row) throw new AgentConfigError("This connection no longer exists.");
  return toConnection(row);
}

/** Endpoints are checked against their connection's base URL and inputs; issues surface as field errors. */
async function assertEndpoint(tx: Tx | typeof db, input: ToolInput): Promise<void> {
  if (!input.connectionId) return;
  const issues = endpointIssues(input, await loadConnection(tx, input.connectionId));
  if (issues.length) throw new z.ZodError(issues);
}

export async function listTools(): Promise<CustomTool[]> {
  return (await db.select().from(aiToolsTable).orderBy(asc(aiToolsTable.name))).map(toTool);
}

export async function getTool(id: string): Promise<CustomTool | null> {
  const [row] = await db.select().from(aiToolsTable).where(eq(aiToolsTable.id, id)).limit(1);
  return row ? toTool(row) : null;
}

export async function createTool(input: ToolInput, actor: string): Promise<CustomTool> {
  try {
    await assertEndpoint(db, input);
    const id = crypto.randomUUID();
    const [row] = await db
      .insert(aiToolsTable)
      .values({ id, ...columns(input), secretValues: sharedSecrets("tool", id, input), updatedBy: actor })
      .returning();
    return toTool(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw keyTaken(input.key);
    throw error;
  }
}

/** Turning on approval re-checks that no blog-generation agent can reach the tool. A tool keeps its connection. */
export async function updateTool(id: string, input: ToolInput, actor: string): Promise<CustomTool> {
  try {
    return await db.transaction(async (tx) => {
      await lockGraph(tx);
      const [current] = await tx
        .select({ connectionId: aiToolsTable.connectionId, secretValues: aiToolsTable.secretValues })
        .from(aiToolsTable)
        .where(eq(aiToolsTable.id, id))
        .limit(1);
      if (!current) throw new AgentConfigError("This custom tool no longer exists.");
      if (current.connectionId !== input.connectionId)
        throw new AgentConfigError("A tool cannot move to or from a connection. Create a new tool instead.");
      await assertEndpoint(tx, input);
      const [row] = await tx
        .update(aiToolsTable)
        .set({
          ...columns(input),
          secretValues: sharedSecrets("tool", id, input, current.secretValues),
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(eq(aiToolsTable.id, id))
        .returning();
      if (input.requiresApproval) await assertApprovalRule(tx);
      return toTool(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw keyTaken(input.key);
    throw error;
  }
}

/** Blocked while any agent uses the tool; the message lists them. */
export async function deleteTool(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGraph(tx);
    const users = await tx
      .select({ name: aiAgentsTable.name })
      .from(aiAgentToolsTable)
      .innerJoin(aiAgentsTable, eq(aiAgentsTable.id, aiAgentToolsTable.agentId))
      .where(eq(aiAgentToolsTable.toolId, id))
      .orderBy(asc(aiAgentsTable.name));
    if (users.length)
      throw new AgentConfigError(`Attached to ${users.map((user) => user.name).join(", ")}. Detach it there first.`);
    await tx.delete(aiToolsTable).where(eq(aiToolsTable.id, id));
  });
}

export async function listConnections(): Promise<ToolConnection[]> {
  return (await db.select().from(aiToolConnectionsTable).orderBy(asc(aiToolConnectionsTable.name))).map(toConnection);
}

export async function getConnection(id: string): Promise<ToolConnection | null> {
  const [row] = await db.select().from(aiToolConnectionsTable).where(eq(aiToolConnectionsTable.id, id)).limit(1);
  return row ? toConnection(row) : null;
}

const connectionKeyTaken = (key: string) =>
  new AgentConfigError(`The key "${key}" is already used by another connection.`);

export async function createConnection(input: ToolConnectionInput, actor: string): Promise<ToolConnection> {
  try {
    const id = crypto.randomUUID();
    const [row] = await db
      .insert(aiToolConnectionsTable)
      .values({ id, ...connectionColumns(input), secretValues: sharedSecrets("conn", id, input), updatedBy: actor })
      .returning();
    return toConnection(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw connectionKeyTaken(input.key);
    throw error;
  }
}

/** Every endpoint must still resolve against the new base URL and inputs. */
export async function updateConnection(id: string, input: ToolConnectionInput, actor: string): Promise<ToolConnection> {
  try {
    return await db.transaction(async (tx) => {
      await lockGraph(tx);
      const endpoints = (await tx.select().from(aiToolsTable).where(eq(aiToolsTable.connectionId, id))).map(toTool);
      for (const endpoint of endpoints) {
        const issue = endpointIssues(endpoint, input)[0];
        if (issue) throw new AgentConfigError(`Endpoint "${endpoint.name}": ${issue.message}`);
      }
      const [current] = await tx
        .select({ secretValues: aiToolConnectionsTable.secretValues })
        .from(aiToolConnectionsTable)
        .where(eq(aiToolConnectionsTable.id, id))
        .limit(1);
      if (!current) throw new AgentConfigError("This connection no longer exists.");
      const [row] = await tx
        .update(aiToolConnectionsTable)
        .set({
          ...connectionColumns(input),
          secretValues: sharedSecrets("conn", id, input, current.secretValues),
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(eq(aiToolConnectionsTable.id, id))
        .returning();
      if (!row) throw new AgentConfigError("This connection no longer exists.");
      return toConnection(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw connectionKeyTaken(input.key);
    throw error;
  }
}

/** Blocked while the connection has endpoints. */
export async function deleteConnection(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGraph(tx);
    const endpoints = await tx
      .select({ id: aiToolsTable.id })
      .from(aiToolsTable)
      .where(eq(aiToolsTable.connectionId, id))
      .limit(1);
    if (endpoints.length) throw new AgentConfigError("Delete this connection's endpoints first.");
    await tx.delete(aiToolConnectionsTable).where(eq(aiToolConnectionsTable.id, id));
  });
}

/** Creates a connection and its endpoints in one transaction (OpenAPI import). */
export async function importConnection(
  connection: ToolConnectionInput,
  tools: ToolInput[],
  actor: string,
): Promise<ToolConnection> {
  const issues = tools.flatMap((tool, index) => endpointIssues(tool, connection, ["tools", index]));
  if (issues.length) throw new z.ZodError(issues);
  try {
    return await db.transaction(async (tx) => {
      const id = crypto.randomUUID();
      const [row] = await tx
        .insert(aiToolConnectionsTable)
        .values({
          id,
          ...connectionColumns(connection),
          secretValues: sharedSecrets("conn", id, connection),
          updatedBy: actor,
        })
        .returning();
      if (tools.length)
        await tx.insert(aiToolsTable).values(
          tools.map((tool) => ({
            id: crypto.randomUUID(),
            ...columns({ ...tool, connectionId: row.id }),
            updatedBy: actor,
          })),
        );
      return toConnection(row);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AgentConfigError(
        "A connection or endpoint key is already used. Change the connection key and import again.",
      );
    throw error;
  }
}

/** Decrypted shared secrets of a saved tool or connection, for the admin Test panel. */
export async function loadSharedSecrets(
  owner: { toolId: string | null } | { connectionId: string },
): Promise<Record<string, string>> {
  const row =
    "connectionId" in owner
      ? (
          await db
            .select()
            .from(aiToolConnectionsTable)
            .where(eq(aiToolConnectionsTable.id, owner.connectionId))
            .limit(1)
        )[0]
      : owner.toolId
        ? (await db.select().from(aiToolsTable).where(eq(aiToolsTable.id, owner.toolId)).limit(1))[0]
        : undefined;
  if (!row) return {};
  const scope = "connectionId" in owner ? "conn" : "tool";
  const decoded = decodeSharedSecrets(
    scope,
    { id: row.id, name: row.name, inputs: row.inputs as ToolInputField[] },
    row.secretValues,
  );
  if (!decoded.ok) throw new AgentConfigError(decoded.error);
  return decoded.value;
}
