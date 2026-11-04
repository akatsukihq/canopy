import { z } from "zod";
import { isIP } from "node:net";
import { parseComposerContent } from "./composerDocument.ts";
import type { JSONContent } from "@tiptap/core";
import type { AssistantRunRequest, AssistantResult } from "./types.ts";

export class AssistantError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
    this.status = status;
  }
}
export const assistantId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
/** Resource ids may be dotted domain keys such as tool ids (`devtools.json-formatter`). */
export const assistantResourceId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_.-]+$/);
export const settingsSchema = z.record(z.string(), z.unknown());
export const threadPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    settings: settingsSchema.optional(),
    composerDraft: z.string().max(8000).optional(),
    composerState: z
      .object({
        agentId: z.string().max(100).optional(),
        agentOffset: z.number().int().min(0).max(8000).optional(),
        content: z.custom<JSONContent>((value) => parseComposerContent(value) !== undefined).optional(),
        attachmentIds: z.array(assistantId).max(5),
      })
      .strict()
      .optional(),
  })
  .strict();
const runRequestSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    clientRequestId: assistantId,
    operation: assistantId,
    agentId: assistantId.optional(),
    message: z.string().trim().max(8000),
    resourceId: assistantResourceId.optional(),
    threadId: assistantId.optional(),
    inputMessageId: assistantId.optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    settings: settingsSchema.optional(),
    references: z.array(z.string().max(2048)).max(5).optional(),
    attachmentIds: z.array(assistantId).max(5).optional(),
  })
  .strict();
export function validateRunRequest(value: unknown): AssistantRunRequest {
  const result = runRequestSchema.parse(value);
  const references = result.references && [...new Set(result.references.map(publicReference))];
  const attachmentIds = [...new Set(result.attachmentIds ?? [])];
  if ((references?.length ?? 0) + attachmentIds.length > 5)
    throw new AssistantError("VALIDATION", "Choose at most five attachments and reference links in total.");
  return {
    ...result,
    references,
    attachmentIds,
  };
}
export const emptyAssistantResult = (): AssistantResult => ({ text: "", citations: [], proposals: [] });

export function publicReference(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AssistantError("VALIDATION", "Reference links must be public HTTPS URLs.");
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const privateHost = !host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host);
  const ipv4 =
    isIP(host) === 4 &&
    /^(0\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|192\.0\.|198\.(18|19)\.|22[4-9]\.|2[3-5]\d\.)/.test(
      host,
    );
  // Reject literal IPv6 references, including mapped private addresses.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    privateHost ||
    ipv4 ||
    isIP(host) === 6 ||
    (url.port && url.port !== "443")
  ) {
    throw new AssistantError("VALIDATION", "Use a public HTTPS reference without credentials or a custom port.");
  }
  return url.href;
}

export function validateAssistantImage(data: Uint8Array, type: string) {
  if (!data.length || data.length > 5 * 1024 * 1024)
    throw new AssistantError("VALIDATION", "Images must be nonempty and at most 5 MiB.");
  const starts = (...bytes: number[]) => bytes.every((value, index) => data[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  const valid =
    type === "image/jpeg"
      ? starts(0xff, 0xd8, 0xff)
      : type === "image/png"
        ? starts(137, 80, 78, 71, 13, 10, 26, 10)
        : type === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!valid) throw new AssistantError("VALIDATION", "Choose a valid JPEG, PNG, or WebP image matching its file type.");
}

/** Persisted Assistant records use only the current schema. */
export function parseStoredRequest(value: unknown): AssistantRunRequest {
  return runRequestSchema.extend({ schemaVersion: z.literal(1) }).parse(value);
}
const proposalSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().optional(),
    status: z.enum(["pending", "applied", "discarded", "stale", "failed"]),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
const resultSchema = z
  .object({
    text: z.string(),
    citations: z.array(z.object({ url: z.string(), title: z.string() }).strict()),
    proposals: z.array(proposalSchema),
    artifact: z
      .object({
        attachmentId: z.string(),
        label: z.string(),
        agentId: z.string(),
        summary: z.string(),
      })
      .catchall(z.unknown())
      .optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export function parseStoredResult(value: unknown): AssistantResult | null {
  return value === null ? null : resultSchema.parse(value);
}
export function parseMessageParts(value: unknown) {
  return z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string() }).strict(),
        z.object({ type: z.literal("attachment"), attachmentId: z.string() }).strict(),
        z.object({ type: z.literal("tool-call"), id: z.string(), name: z.string(), input: z.unknown() }).strict(),
        z.object({ type: z.literal("tool-result"), id: z.string(), name: z.string(), output: z.unknown() }).strict(),
        z.object({ type: z.literal("proposal"), proposal: proposalSchema }).strict(),
      ]),
    )
    .parse(value);
}
