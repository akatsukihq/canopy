/** Server-only remote MCP client lifecycle: SSRF-checked connections, tool listing and allowlisted tools. */
import "server-only";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import type { AITool } from "../ai/types.ts";
import { assertPublicHttpsUrl, BlockedUrlError } from "./publicUrl.ts";
import type { McpToolInfo, McpToolRef } from "./types.ts";

/** Decrypted server configuration. Headers are secrets: never send them to the browser or logs. */
export type McpServerRuntime = {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  headers: Record<string, string>;
  /** Admin-reviewed tool list (ai_mcp_servers.tools); the runtime trusts these descriptions, not live ones. */
  tools: McpToolInfo[];
};

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_TOOL_OUTPUT_BYTES = 100 * 1024;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_TOOL_PAGES = 10;

const MCP_MESSAGES: Record<BlockedUrlError["reason"], string> = {
  invalid: "Enter a valid MCP server URL.",
  private: "MCP servers must use a public HTTPS address.",
  credentials: "Put MCP credentials in headers, not the URL.",
  unresolved: "The MCP server host could not be resolved.",
};

/** Throws unless the URL is https and every address its host resolves to is public. */
export async function assertPublicMcpUrl(url: string): Promise<URL> {
  try {
    return await assertPublicHttpsUrl(url);
  } catch (error) {
    throw error instanceof BlockedUrlError ? new Error(MCP_MESSAGES[error.reason]) : error;
  }
}

/** Re-checks the destination on every request (DNS rebinding) and refuses redirects. */
function guardedFetch(signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    await assertPublicMcpUrl(target);
    const signals = [init?.signal, signal].filter((value): value is AbortSignal => Boolean(value));
    // ponytail: check-then-fetch leaves a resolver race; pin the vetted IP with an undici dispatcher if it matters.
    const response = await fetch(input, {
      ...init,
      redirect: "error",
      signal: signals.length ? AbortSignal.any(signals) : undefined,
    });
    return cappedBody(response);
  };
}

/**
 * Errors the body stream past MAX_RESPONSE_BYTES. SSE streams are long-lived, so they are capped per event
 * (bytes since the last blank line) instead of in total.
 * ponytail: per-event SSE cap only recognises \n / \r\n line endings; a bare-\r stream is capped in total.
 */
function cappedBody(response: Response): Response {
  if (!response.body) return response;
  const sse = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
  let size = 0;
  let newline = false;
  const tooLarge = () => new Error("The MCP server response exceeded 2 MB.");
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (sse) {
        for (const byte of chunk) {
          if (byte === 13) continue;
          size = byte === 10 && newline ? 0 : size + 1;
          newline = byte === 10;
          if (size > MAX_RESPONSE_BYTES) return controller.error(tooLarge());
        }
      } else if ((size += chunk.byteLength) > MAX_RESPONSE_BYTES) return controller.error(tooLarge());
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(cap), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function connect(server: McpServerRuntime, signal?: AbortSignal): Promise<MCPClient> {
  await assertPublicMcpUrl(server.url);
  const startup = AbortSignal.any([AbortSignal.timeout(CONNECT_TIMEOUT_MS), ...(signal ? [signal] : [])]);
  return createMCPClient({
    transport: {
      type: server.transport,
      url: server.url,
      headers: server.headers,
      redirect: "error",
      fetch: guardedFetch(signal),
    },
    initializationOptions: { signal: startup, timeout: CONNECT_TIMEOUT_MS },
  });
}

type ListedTool = Awaited<ReturnType<MCPClient["listTools"]>>["tools"][number];

async function allTools(client: MCPClient, signal?: AbortSignal): Promise<ListedTool[]> {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = await client.listTools({
      params: cursor ? { cursor } : undefined,
      options: { signal, timeout: CONNECT_TIMEOUT_MS },
    });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

/** Lists a server's tools for the admin editor. */
export async function listMcpTools(server: McpServerRuntime, signal?: AbortSignal): Promise<McpToolInfo[]> {
  const client = await connect(server, signal);
  try {
    return (await allTools(client, signal)).map((tool) => ({ name: tool.name, description: tool.description ?? "" }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Model-facing tool name: `mcp_<first 8 alphanumerics of the server id>_<tool>`, [a-zA-Z0-9_] only, at most
 * 64 characters. Keyed by id, not name, so renaming or duplicating a server name cannot shadow a tool.
 */
export function mcpToolName(serverId: string, tool: string): string {
  const slug = serverId
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return `mcp_${slug}_${tool}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
}

/** Cuts `text` to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return `${bytes.subarray(0, end).toString()}\n[Output truncated at ${Math.round(maxBytes / 1024)} KB.]`;
}

/** Text parts share the output budget; other parts are summarised, never dumped. */
function toolText(result: Awaited<ReturnType<MCPClient["callTool"]>>): string {
  if (!("content" in result) || !Array.isArray(result.content))
    return truncateUtf8(JSON.stringify(result.toolResult ?? null), MAX_TOOL_OUTPUT_BYTES);
  let budget = MAX_TOOL_OUTPUT_BYTES;
  const parts: string[] = [];
  for (const part of result.content) {
    if (budget <= 0) {
      parts.push("[Further output omitted.]");
      break;
    }
    const text =
      part.type === "text" ? truncateUtf8(String(part.text), budget) : `[${String(part.type)} content omitted]`;
    budget -= Buffer.byteLength(text);
    parts.push(text);
  }
  return parts.join("\n");
}

function inputSchema(schema: unknown): z.ZodType {
  try {
    return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch {
    return z.record(z.string(), z.unknown());
  }
}

/**
 * Connects to the referenced servers and exposes only the allowlisted tools. A server that fails to
 * connect is reported and skipped. `close()` is idempotent; callers close when the run ends or aborts.
 */
export async function openMcpTools(
  servers: McpServerRuntime[],
  refs: McpToolRef[],
  signal: AbortSignal,
  reportToolFailure: (toolName: string, error: unknown) => void = () => undefined,
): Promise<{ tools: Record<string, AITool>; close(): Promise<void> }> {
  const used = servers.filter((server) => refs.some((ref) => ref.serverId === server.id));
  const clients: MCPClient[] = [];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.all(clients.map((client) => client.close().catch(() => undefined))).then(() => undefined));
  const entries = await Promise.all(
    used.map(async (server): Promise<[string, AITool][]> => {
      try {
        const client = await connect(server, signal);
        clients.push(client);
        if (closing) await client.close().catch(() => undefined);
        const allowed = new Set(refs.filter((ref) => ref.serverId === server.id).map((ref) => ref.tool));
        return (await allTools(client, signal))
          .filter((tool) => allowed.has(tool.name))
          .flatMap((tool): [string, AITool][] => {
            const name = mcpToolName(server.id, tool.name);
            const reviewed = server.tools.find((cached) => cached.name === tool.name);
            if (!reviewed || reviewed.description !== (tool.description ?? "")) {
              reportToolFailure(
                name,
                new Error(
                  `The ${tool.name} tool on ${server.name} ${reviewed ? "changed its description" : "is not in the reviewed tool list"}. An admin must refresh this server's tools and review them before it can be used.`,
                ),
              );
              return [];
            }
            const label = `Untrusted tool output from ${server.name} / ${tool.name}:\n`;
            const execute: AITool["execute"] = async (input, context) => {
              try {
                const result = await client.callTool({
                  name: tool.name,
                  arguments: (input ?? {}) as Record<string, unknown>,
                  options: { signal: context.signal ?? signal, timeout: CALL_TIMEOUT_MS },
                });
                const text = toolText(result);
                if ("isError" in result && result.isError) {
                  reportToolFailure(name, new Error(text.slice(0, 2000)));
                  return `Tool error. ${label}${text}`;
                }
                return `${label}${text}`;
              } catch (error) {
                reportToolFailure(name, error);
                return `Tool error: the ${tool.name} tool on ${server.name} failed. Continue without it.`;
              }
            };
            const description = reviewed.description.slice(0, MAX_DESCRIPTION_CHARS) || tool.name;
            return [[name, { description, inputSchema: inputSchema(tool.inputSchema), execute }]];
          });
      } catch (error) {
        reportToolFailure(`mcp_${server.name}`, error);
        return [];
      }
    }),
  );
  const tools: Record<string, AITool> = {};
  for (const [name, tool] of entries.flat()) {
    if (name in tools) {
      await close();
      throw new Error(`Two MCP tools map to the model-facing name "${name}". Remove one of them from the agent.`);
    }
    tools[name] = tool;
  }
  return { tools, close };
}
