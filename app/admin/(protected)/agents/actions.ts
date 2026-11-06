"use server";

import { captureException } from "@sentry/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/index.ts";
import { getActorUserId } from "@/lib/admin/access";
import { writeAudit } from "@/lib/admin/adminMutations.ts";
import { AuthorizationError, requirePermission } from "@/lib/admin/index.ts";
import { assertPublicMcpUrl, listMcpTools } from "@/lib/agents/mcp";
import {
  AgentConfigError,
  createAgent,
  describeMcpFailure,
  createMcpServer,
  createSkill,
  deleteAgent as removeAgent,
  deleteMcpServer as removeMcpServer,
  deleteSkill as removeSkill,
  loadMcpServerRuntime,
  saveMcpToolCache,
  updateAgent,
  updateMcpServer,
  updateSkill,
} from "@/lib/agents/store.ts";
import {
  agentInputSchema,
  mcpServerInputSchema,
  skillInputSchema,
  type Agent,
  type McpServer,
  type McpToolInfo,
  type Skill,
} from "@/lib/agents/types.ts";
import { runCustomTool, type ToolRunReport } from "@/lib/agents/toolRuntime";
import { previewOpenApi, type OpenApiPreview } from "@/lib/agents/openApiImport.ts";
import { bindConnection, toolConnectionInputSchema, type ToolConnection } from "@/lib/agents/toolConnections.ts";
import {
  createConnection,
  createTool,
  deleteConnection as removeConnection,
  deleteTool as removeTool,
  getConnection,
  importConnection,
  loadSharedSecrets,
  updateConnection,
  updateTool,
} from "@/lib/agents/toolStore";
import { toolInputSchema, type CustomTool } from "@/lib/agents/toolTypes.ts";
import { logError } from "@/lib/observability/logger.ts";
import { measureServerAction } from "@/lib/observability/sentry.ts";

export type AgentActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function requireEditor(): Promise<string> {
  const actor = await getActorUserId();
  await requirePermission(actor, "agents", "edit");
  return actor;
}

function failure(error: unknown, fallback: string): AgentActionResult<never> {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) fieldErrors[issue.path.join(".")] ||= issue.message;
    return { ok: false, error: "Fix the highlighted fields.", fieldErrors };
  }
  if (error instanceof AuthorizationError) return { ok: false, error: error.message };
  if (error instanceof AgentConfigError) return { ok: false, error: error.message };
  captureException(error);
  return { ok: false, error: fallback };
}

const audit = (
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
) => db.transaction((tx) => writeAudit(tx, actor, action, targetType, targetId, metadata));

async function run<T>(
  name: string,
  fallback: string,
  work: (actor: string) => Promise<T>,
): Promise<AgentActionResult<T>> {
  return measureServerAction<AgentActionResult<T>>(`admin.agents.${name}`, async () => {
    try {
      const data = await work(await requireEditor());
      revalidatePath("/admin/agents");
      return { ok: true, data };
    } catch (error) {
      return failure(error, fallback);
    }
  });
}

export async function saveAgent(
  id: string | null,
  input: unknown,
  expectedVersion?: number,
): Promise<AgentActionResult<Agent>> {
  return run("saveAgent", "The agent could not be saved.", async (actor) => {
    const parsed = agentInputSchema.parse(input);
    if (id && expectedVersion === undefined) throw new AgentConfigError("Reload the agent and try again.");
    const agent = id
      ? await updateAgent(id, parsed, expectedVersion as number, actor)
      : await createAgent(parsed, actor);
    await audit(actor, id ? "agent.update" : "agent.create", "ai_agent", agent.id, {
      key: agent.key,
      version: agent.version,
    });
    return agent;
  });
}

export async function deleteAgent(id: string): Promise<AgentActionResult<null>> {
  return run("deleteAgent", "The agent could not be deleted.", async (actor) => {
    await removeAgent(id, actor);
    await audit(actor, "agent.delete", "ai_agent", id);
    return null;
  });
}

export async function saveSkill(id: string | null, input: unknown): Promise<AgentActionResult<Skill>> {
  return run("saveSkill", "The skill could not be saved.", async (actor) => {
    const parsed = skillInputSchema.parse(input);
    const skill = id ? await updateSkill(id, parsed) : await createSkill(parsed);
    await audit(actor, id ? "skill.update" : "skill.create", "ai_skill", skill.id, { key: skill.key });
    return skill;
  });
}

export async function deleteSkill(id: string): Promise<AgentActionResult<null>> {
  return run("deleteSkill", "The skill could not be deleted.", async (actor) => {
    await removeSkill(id);
    await audit(actor, "skill.delete", "ai_skill", id);
    return null;
  });
}

export async function saveMcpServer(id: string | null, input: unknown): Promise<AgentActionResult<McpServer>> {
  return run("saveMcpServer", "The MCP server could not be saved.", async (actor) => {
    const parsed = mcpServerInputSchema.parse(input);
    await assertPublicMcpUrl(parsed.url).catch((error: unknown) => {
      // The guard's messages are fixed, user-facing strings.
      throw new AgentConfigError(error instanceof Error ? error.message : "The MCP server address is not allowed.");
    });
    const server = id ? await updateMcpServer(id, parsed) : await createMcpServer(parsed);
    // Header names only; values are never logged.
    await audit(actor, id ? "mcp_server.update" : "mcp_server.create", "ai_mcp_server", server.id, {
      name: server.name,
      url: server.url,
      headerNames: server.headerNames,
    });
    return server;
  });
}

export async function deleteMcpServer(id: string): Promise<AgentActionResult<null>> {
  return run("deleteMcpServer", "The MCP server could not be deleted.", async (actor) => {
    await removeMcpServer(id);
    await audit(actor, "mcp_server.delete", "ai_mcp_server", id);
    return null;
  });
}

/** Connects to the server, lists its tools and caches them. A failed connection is saved as the server's last error. */
export async function refreshMcpTools(id: string): Promise<AgentActionResult<McpToolInfo[]>> {
  return run("refreshMcpTools", "The MCP server could not be reached.", async () => {
    const runtime = await loadMcpServerRuntime(id);
    try {
      await assertPublicMcpUrl(runtime.url);
      const tools = await listMcpTools(runtime, AbortSignal.timeout(20_000));
      await saveMcpToolCache(id, tools, null);
      return tools;
    } catch (error) {
      logError("admin.agents.mcp_refresh_failed", error, { serverId: id });
      const message = describeMcpFailure(error).slice(0, 300);
      await saveMcpToolCache(id, null, message);
      throw new AgentConfigError(message);
    }
  });
}

export async function saveTool(id: string | null, input: unknown): Promise<AgentActionResult<CustomTool>> {
  return run("saveTool", "The custom tool could not be saved.", async (actor) => {
    const parsed = toolInputSchema.parse(input);
    const tool = id ? await updateTool(id, parsed, actor) : await createTool(parsed, actor);
    await audit(actor, id ? "ai_tool.update" : "ai_tool.create", "ai_tool", tool.id, {
      key: tool.key,
      kind: tool.kind,
    });
    return tool;
  });
}

export async function deleteTool(id: string): Promise<AgentActionResult<null>> {
  return run("deleteTool", "The custom tool could not be deleted.", async (actor) => {
    await removeTool(id);
    await audit(actor, "ai_tool.delete", "ai_tool", id);
    return null;
  });
}

const testInputSchema = z.object({
  args: z.unknown(),
  inputs: z.record(z.string(), z.string().max(4000)),
  /** Saved tool whose stored shared secrets fill blanks. */
  toolId: z.string().min(1).nullable().default(null),
});

const TEST_TIMEOUT_MS = 90_000;

/** Runs the editor's current (unsaved) definition once. Approval is skipped; entered secrets are not stored. */
export async function testTool(input: unknown, sample: unknown): Promise<AgentActionResult<ToolRunReport>> {
  return measureServerAction<AgentActionResult<ToolRunReport>>("admin.agents.testTool", async () => {
    try {
      await requireEditor();
      const parsed = toolInputSchema.parse(input);
      const { args, inputs, toolId } = testInputSchema.parse(sample);
      const connection = parsed.connectionId ? await getConnection(parsed.connectionId) : null;
      if (parsed.connectionId && !connection) return { ok: false, error: "This connection no longer exists." };
      const { secretValues, ...tool } = connection ? bindConnection(parsed, connection) : parsed;
      // Blanks fall back to stored shared secrets, then to shared values typed in the editor but not saved yet.
      const saved = await loadSharedSecrets(connection ? { connectionId: connection.id } : { toolId });
      // A shared value cleared in the editor ("") no longer applies, even before saving.
      const stored = Object.fromEntries(Object.entries(saved).filter(([id]) => connection || secretValues[id] !== ""));
      const typed = Object.fromEntries(
        Object.entries(secretValues).filter((entry): entry is [string, string] => !!entry[1]),
      );
      const filled = Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== ""));
      const definition: CustomTool = {
        ...tool,
        id: "test",
        savedSecretValues: [],
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      };
      const values = { ...stored, ...(connection ? {} : typed), ...filled };
      return { ok: true, data: await runCustomTool(definition, args, values, AbortSignal.timeout(TEST_TIMEOUT_MS)) };
    } catch (error) {
      return failure(error, "The test could not run.");
    }
  });
}

export async function saveConnection(id: string | null, input: unknown): Promise<AgentActionResult<ToolConnection>> {
  return run("saveConnection", "The connection could not be saved.", async (actor) => {
    const parsed = toolConnectionInputSchema.parse(input);
    const connection = id ? await updateConnection(id, parsed, actor) : await createConnection(parsed, actor);
    await audit(actor, id ? "ai_connection.update" : "ai_connection.create", "ai_connection", connection.id, {
      key: connection.key,
    });
    return connection;
  });
}

export async function deleteConnection(id: string): Promise<AgentActionResult<null>> {
  return run("deleteConnection", "The connection could not be deleted.", async (actor) => {
    await removeConnection(id);
    await audit(actor, "ai_connection.delete", "ai_connection", id);
    return null;
  });
}

const MAX_SPEC_CHARS = 5_000_000;

/** Parses an OpenAPI document into a reviewable proposal. Nothing is saved. */
export async function previewOpenApiImport(source: unknown): Promise<AgentActionResult<OpenApiPreview>> {
  return measureServerAction<AgentActionResult<OpenApiPreview>>("admin.agents.previewOpenApi", async () => {
    try {
      await requireEditor();
      const text = z
        .string()
        .min(1, "Paste or upload an OpenAPI document.")
        .max(MAX_SPEC_CHARS, "The document is too large (5 MB max).")
        .parse(source);
      const result = previewOpenApi(text);
      return result.ok ? { ok: true, data: result.preview } : { ok: false, error: result.error };
    } catch (error) {
      return failure(error, "The document could not be read.");
    }
  });
}

/** Endpoints are validated as endpoints (path URLs); the real connection id is set on insert. */
const importedEndpoint = z.preprocess(
  (tool) => (tool && typeof tool === "object" ? { ...tool, connectionId: "import" } : tool),
  toolInputSchema,
);

const importSchema = z
  .object({
    connection: toolConnectionInputSchema,
    tools: z.array(importedEndpoint).min(1, "Choose at least one endpoint.").max(200),
  })
  .strict();

/** Creates the reviewed connection and its chosen endpoints. Everything is validated again here. */
export async function importOpenApiConnection(input: unknown): Promise<AgentActionResult<ToolConnection>> {
  return run("importOpenApi", "The import could not be saved.", async (actor) => {
    const { connection, tools } = importSchema.parse(input);
    const created = await importConnection(connection, tools, actor);
    await audit(actor, "ai_connection.import", "ai_connection", created.id, {
      key: created.key,
      endpoints: tools.length,
    });
    return created;
  });
}
