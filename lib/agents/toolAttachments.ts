/**
 * Server-only rules for custom tools attached to agents: input encoding (secrets encrypted with AAD bound to
 * agent, tool and field), the browser-safe view, decryption for runs, and the approval-in-generation rule.
 */
import "server-only";
import { decryptSecret, encryptSecret, SecretsUnavailableError } from "../config/secrets.ts";
import { isJson, type ToolInputField } from "./toolTypes.ts";
import type { AgentToolAttachment, AgentToolInput } from "./types.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** A tool or a connection: whatever declares input fields. Secrets are bound to agent, owner and field. */
type InputOwner = { id: string; name: string; inputs: ToolInputField[]; savedSecretValues?: readonly string[] };
export type InputScope = "tool" | "conn";

const TYPE_RULES: Partial<Record<ToolInputField["type"], string>> = {
  url: "an https:// address",
  number: "a number",
  json: "valid JSON",
};

const inputAad = (scope: InputScope, agentId: string, ownerId: string, fieldId: string) =>
  `${scope}:${agentId}:${ownerId}:${fieldId}`;

function checkValue(type: ToolInputField["type"], value: string): boolean {
  if (type === "number") return value.trim() !== "" && Number.isFinite(Number(value));
  if (type === "json") return isJson(value);
  if (type !== "url") return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates one attachment and returns the stored form. A secret of null keeps `stored`'s value; "" clears it.
 * Required inputs must end up with a value (a non-secret default counts).
 */
export function encodeAttachmentInputs(
  agentId: string,
  tool: InputOwner,
  inputs: AgentToolInput["inputs"],
  stored: Record<string, unknown> = {},
  scope: InputScope = "tool",
): Result<Record<string, unknown>> {
  const unknown = Object.keys(inputs).find((id) => !tool.inputs.some((field) => field.id === id));
  if (unknown) return { ok: false, error: `"${tool.name}" has no input named ${unknown}. Reload and try again.` };
  const encoded: Record<string, unknown> = {};
  // A shared value on the tool/connection satisfies a required secret.
  const shared = (id: string) => tool.savedSecretValues?.includes(id) ?? false;
  for (const field of tool.inputs) {
    const value = inputs[field.id];
    const missing = () => ({ ok: false as const, error: `"${tool.name}": enter ${field.label}.` });
    if (field.type === "secret") {
      if (value === null || value === undefined) {
        if (stored[field.id] && typeof stored[field.id] === "object") encoded[field.id] = stored[field.id];
        else if (field.required && !shared(field.id)) return missing();
      } else if (value !== "") {
        try {
          encoded[field.id] = encryptSecret(value, inputAad(scope, agentId, tool.id, field.id));
        } catch (error) {
          if (error instanceof SecretsUnavailableError) return { ok: false, error: error.message };
          throw error;
        }
      } else if (field.required && !shared(field.id)) return missing();
      continue;
    }
    if (!value) {
      if (field.required && !field.defaultValue) return missing();
      continue;
    }
    if (!checkValue(field.type, value))
      return {
        ok: false,
        error: `"${tool.name}": ${field.label} must be ${TYPE_RULES[field.type] ?? "valid"}.`,
      };
    encoded[field.id] = value;
  }
  return { ok: true, value: encoded };
}

/** Browser-safe view of a stored attachment: plain values, and which secrets have a stored value. */
export function publicAttachment(toolId: string, stored: Record<string, unknown>): AgentToolAttachment {
  return { toolId, ...publicInputs(stored) };
}

export function publicInputs(stored: Record<string, unknown>): Omit<AgentToolAttachment, "toolId"> {
  const inputs: Record<string, string> = {};
  const savedSecrets: string[] = [];
  for (const [id, value] of Object.entries(stored)) {
    if (typeof value === "string") inputs[id] = value;
    else if (value && typeof value === "object") savedSecrets.push(id);
  }
  return { inputs, savedSecrets };
}

/** Decrypted values for a run. Fields the tool no longer declares, or whose type changed, are dropped. */
export function decodeAttachmentInputs(
  agentId: string,
  tool: InputOwner,
  stored: Record<string, unknown>,
  scope: InputScope = "tool",
): Result<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const field of tool.inputs) {
    const value = stored[field.id];
    if (field.type !== "secret") {
      if (typeof value === "string") values[field.id] = value;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const plain = decryptSecret(value, inputAad(scope, agentId, tool.id, field.id));
    if (plain === null)
      return {
        ok: false,
        error: `"${tool.name}": ${field.label} could not be decrypted. Re-enter it in Admin.`,
      };
    values[field.id] = plain;
  }
  return { ok: true, value: values };
}

type GraphAgent = {
  id: string;
  name: string;
  sections: readonly string[];
  subagents: { mode: string; agentIds: readonly string[] };
  toolIds: readonly string[];
};

/**
 * Approval pauses only work in interactive sections. Returns a message when an approval-required tool is
 * reachable (directly, via delegate or via pipeline) from an agent listed in blog generation.
 */
export function approvalInGenerationError(
  agents: readonly GraphAgent[],
  approvalTools: ReadonlyMap<string, string>,
): string | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const root of agents) {
    if (!root.sections.includes("blog-generation")) continue;
    const seen = new Set<string>();
    const queue = [root.id];
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      const agent = byId.get(id);
      if (!agent || seen.has(id)) continue;
      seen.add(id);
      const toolId = agent.toolIds.find((candidate) => approvalTools.has(candidate));
      if (toolId) {
        const via = agent.id === root.id ? "" : ` through "${root.name}"`;
        return `The "${approvalTools.get(toolId)}" tool needs approval, so "${agent.name}" cannot use it while blog generation runs it${via}. Approval works only in the blog editor and tool content. Turn off approval for the tool or detach it.`;
      }
      if (agent.subagents.mode !== "none") queue.push(...agent.subagents.agentIds);
    }
  }
  return null;
}

const sharedAad = (scope: InputScope, ownerId: string, fieldId: string) => `${scope}def:${ownerId}:${fieldId}`;

/**
 * Stored form of a tool's or connection's shared secret values. Per field: a string encrypts a new value, "" clears
 * it, null/absent keeps the stored one. Fields that are no longer secrets are dropped.
 */
export function encodeSharedSecrets(
  scope: InputScope,
  ownerId: string,
  fields: readonly ToolInputField[],
  submitted: Record<string, string | null>,
  stored: Record<string, unknown> = {},
): Result<Record<string, unknown>> {
  const encoded: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type !== "secret") continue;
    const value = submitted[field.id];
    if (value === null || value === undefined) {
      if (stored[field.id] && typeof stored[field.id] === "object") encoded[field.id] = stored[field.id];
    } else if (value !== "") {
      try {
        encoded[field.id] = encryptSecret(value, sharedAad(scope, ownerId, field.id));
      } catch (error) {
        if (error instanceof SecretsUnavailableError) return { ok: false, error: error.message };
        throw error;
      }
    }
  }
  return { ok: true, value: encoded };
}

/** Decrypted shared secret values for a run; undecryptable values are an error naming the field. */
export function decodeSharedSecrets(
  scope: InputScope,
  owner: { id: string; name: string; inputs: readonly ToolInputField[] },
  stored: Record<string, unknown>,
): Result<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const field of owner.inputs) {
    if (field.type !== "secret" || !stored[field.id] || typeof stored[field.id] !== "object") continue;
    const plain = decryptSecret(stored[field.id], sharedAad(scope, owner.id, field.id));
    if (plain === null)
      return { ok: false, error: `"${owner.name}": the shared ${field.label} could not be decrypted. Re-enter it.` };
    values[field.id] = plain;
  }
  return { ok: true, value: values };
}
