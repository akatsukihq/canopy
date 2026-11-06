/** Server-only private conversation storage. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  and,
  db,
  desc,
  eq,
  inArray,
  sql,
  assistantThreadsTable as threads,
  assistantRunsTable as runs,
  assistantAttachmentsTable as attachments,
  assistantMessagesTable as messages,
} from "../../db/index.ts";
import { loadRuntimeSettings } from "../config/runtimeSettings.ts";
import { activeAIProvider, createAIClient } from "../config/integrations.ts";
import {
  parseStoredRequest,
  parseStoredResult,
  parseMessageParts,
  AssistantError,
  assistantId,
  assistantResourceId,
  threadPatchSchema,
  validateAssistantImage,
  publicReference,
} from "./validation.ts";
import type {
  AssistantThread,
  AssistantAttachment,
  AssistantRun,
  AssistantAvailability,
  AssistantMessage,
  AssistantApproval,
  AssistantExecutionSummary,
  AssistantRunRequest,
  AssistantResult,
} from "./types.ts";

import type { AssistantIntegration, AssistantTransaction, StoredRun } from "./integration.ts";
import { attachmentProvider, deleteRunResponses } from "./resources.ts";
import { NEW_THREAD_TITLE } from "./types.ts";
export const ACTIVE_RUN_STATUSES = ["queued", "running", "unknown"] as const;
export const privateExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const storedApproval = z.object({
  calls: z.array(z.object({ toolCallId: z.string(), toolName: z.string(), input: z.unknown() })).min(1),
  decision: z.object({ approved: z.boolean() }).passthrough().optional(),
});
/** The browser-safe view of a run's approval request (never its saved conversation). */
export function approvalView(continuation: Record<string, unknown>): AssistantApproval | undefined {
  const parsed = storedApproval.safeParse(continuation.approval);
  if (!parsed.success) return undefined;
  const { calls, decision } = parsed.data;
  return {
    calls: calls.map(({ toolCallId, toolName, input }) => ({ toolCallId, toolName, input })),
    ...(decision ? { decision: decision.approved ? ("approved" as const) : ("rejected" as const) } : {}),
  };
}

export function createAssistantThreads(integration: AssistantIntegration) {
  function threadView(row: typeof threads.$inferSelect): AssistantThread {
    const { composerDraft, composerState, ...settings } = row.settings;
    return {
      id: row.id,
      resourceId: row.resourceId,
      integrationKey: row.integrationKey,
      title: row.title,
      type: row.type,
      settings: integration.validateSettings(settings),
      composerDraft: typeof composerDraft === "string" ? composerDraft : "",
      composerState: threadPatchSchema.shape.composerState.catch(undefined).parse(composerState),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  function attachmentView(row: typeof attachments.$inferSelect, full = false): AssistantAttachment {
    const data = z
      .object({ url: z.string().optional(), mimeType: z.string().optional(), sizeBytes: z.number().optional() })
      .catch({})
      .parse(row.data);
    if (data.url) {
      try {
        data.url = publicReference(data.url);
      } catch {
        delete data.url;
      }
    }
    return {
      id: row.id,
      threadId: row.threadId,
      messageId: row.messageId,
      runId: row.runId,
      type: row.type,
      label: row.label,
      data: row.type === "artifact" ? artifactData(row.data.artifact, full) : data,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  function artifactData(value: unknown, full: boolean): AssistantAttachment["data"] {
    const summary = z
      .object({
        agentId: z.string(),
        summary: z.string().max(2000),
        schemaVersion: z.number(),
        agentVersion: z.number(),
      })
      .safeParse(value);
    if (!summary.success) return {};
    return { artifactSummary: summary.data, ...(full && integration.isArtifact(value) ? { artifact: value } : {}) };
  }
  function executionView(
    row: Pick<
      StoredRun,
      | "id"
      | "operation"
      | "executionMode"
      | "status"
      | "createdAt"
      | "updatedAt"
      | "completedAt"
      | "expiresAt"
      | "errorMessage"
      | "request"
      | "response"
      | "continuation"
    >,
  ): AssistantExecutionSummary {
    const available = row.expiresAt.getTime() > Date.now() && row.continuation.cleared !== true;
    return {
      id: row.id,
      operation: row.operation,
      executionMode: row.executionMode,
      agentId: available ? row.request.agentId : undefined,
      requestMessage: available ? row.request.message : undefined,
      status: row.status,
      label: available
        ? (row.response?.artifact?.label ?? integration.operationLabel(row.operation, row.request.agentId))
        : "Expired result",
      artifact: available ? row.response?.artifact : undefined,
      errorMessage: available ? row.errorMessage : "This result has expired.",
      ...(available && approvalView(row.continuation) ? { approval: approvalView(row.continuation) } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  const pageCursor = (row: { id: string; createdAt: Date }) =>
    Buffer.from(JSON.stringify({ id: row.id })).toString("base64url");
  function readCursor(value?: string | null) {
    if (!value) return undefined;
    try {
      if (value.length > 500) throw new Error();
      return z
        .object({ id: assistantId })
        .strict()
        .parse(JSON.parse(Buffer.from(value, "base64url").toString()));
    } catch {
      throw new AssistantError("VALIDATION", "The page cursor is invalid.");
    }
  }
  async function executionPage(tx: AssistantTransaction, actor: string, threadId: string, cursor?: string | null) {
    const after = readCursor(cursor);
    if (after) {
      const [anchor] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, after.id), eq(runs.threadId, threadId), eq(runs.ownerId, actor)));
      if (!anchor) throw new AssistantError("VALIDATION", "This page is no longer available. Refresh the results.");
    }
    const rows = await tx
      .select({
        id: runs.id,
        operation: runs.operation,
        executionMode: runs.executionMode,
        status: runs.status,
        createdAt: runs.createdAt,
        updatedAt: runs.updatedAt,
        completedAt: runs.completedAt,
        expiresAt: runs.expiresAt,
        errorMessage: runs.errorMessage,
        request: sql<AssistantRunRequest>`jsonb_build_object('agentId', ${runs.request}->>'agentId', 'message', ${runs.request}->>'message')`,
        response: sql<AssistantResult | null>`CASE WHEN ${runs.response} IS NULL THEN NULL ELSE jsonb_build_object('artifact', ${runs.response}->'artifact') END`,
        continuation: sql<
          Record<string, unknown>
        >`jsonb_strip_nulls(jsonb_build_object('approval', ${runs.continuation}->'approval'))`,
      })
      .from(runs)
      .where(
        and(
          eq(runs.threadId, threadId),
          eq(runs.ownerId, actor),
          eq(runs.executionMode, "standalone"),
          sql`coalesce(${runs.continuation}->>'cleared','false') <> 'true'`,
          after
            ? sql`(${runs.createdAt}, ${runs.id}) < ((SELECT created_at FROM assistant_runs WHERE id = ${after.id}), ${after.id})`
            : undefined,
        ),
      )
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(26);
    return {
      executions: rows.slice(0, 25).map(executionView),
      nextCursor: rows.length > 25 ? pageCursor(rows[24]) : null,
    };
  }
  async function getThreadExecutions(
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    cursor?: string | null,
  ) {
    return db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId);
      return executionPage(tx, actor, threadId, cursor);
    });
  }
  async function listThreadAttachments(
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    kind: string | null,
    cursor?: string | null,
  ) {
    if (kind !== "sources" && kind !== "artifacts")
      throw new AssistantError("VALIDATION", "Choose sources or artifacts.");
    return db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId);
      const after = readCursor(cursor);
      if (after) {
        const [anchor] = await tx
          .select({ id: attachments.id })
          .from(attachments)
          .where(and(eq(attachments.id, after.id), eq(attachments.threadId, threadId), eq(attachments.ownerId, actor)));
        if (!anchor) throw new AssistantError("VALIDATION", "This page is no longer available. Refresh the library.");
      }
      const rows = await tx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.threadId, threadId),
            eq(attachments.ownerId, actor),
            kind === "artifacts" ? eq(attachments.type, "artifact") : sql`${attachments.type} IN ('file','link')`,
            sql`${attachments.status} <> 'deleting'`,
            kind === "artifacts"
              ? sql`(${attachments.expiresAt} IS NULL OR ${attachments.expiresAt} > now())`
              : undefined,
            after
              ? sql`(${attachments.createdAt}, ${attachments.id}) < ((SELECT created_at FROM assistant_attachments WHERE id = ${after.id}), ${after.id})`
              : undefined,
          ),
        )
        .orderBy(desc(attachments.createdAt), desc(attachments.id))
        .limit(26);
      return {
        attachments: rows.slice(0, 25).map((row) => attachmentView(row)),
        nextCursor: rows.length > 25 ? pageCursor(rows[24]) : null,
      };
    });
  }
  async function getThreadAttachment(
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    id: string,
  ) {
    assistantId.parse(id);
    return db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId);
      const [row] = await tx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, id),
            eq(attachments.threadId, threadId),
            eq(attachments.ownerId, actor),
            eq(attachments.status, "ready"),
            sql`(${attachments.expiresAt} IS NULL OR ${attachments.expiresAt} > now())`,
          ),
        );
      if (!row) throw new AssistantError("NOT_FOUND", "This attachment is unavailable or expired.", 404);
      const attachment = attachmentView(row, true);
      const detail = attachment.data.artifact ? integration.artifactDetail(attachment.data.artifact) : {};
      return { attachment, ...detail };
    });
  }
  function messageView(row: typeof messages.$inferSelect): AssistantMessage {
    // Provider details stay server-side; only normalized usage and identity are UI metadata.
    const provider = z.object({ name: z.string(), model: z.string().optional() }).safeParse(row.meta.provider);
    const usage = z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        totalTokens: z.number().optional(),
      })
      .safeParse(row.meta.usage);
    return {
      ...row,
      parts: parseMessageParts(row.parts),
      meta: {
        ...(provider.success ? { provider: provider.data } : {}),
        ...(usage.success ? { usage: usage.data } : {}),
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  function runView(row: StoredRun): AssistantRun {
    return {
      id: row.id,
      threadId: row.threadId,
      resourceId: row.resourceId,
      integrationKey: row.integrationKey,
      operation: row.operation,
      executionMode: row.executionMode,
      status: row.status,
      provider: row.provider,
      model: row.model,
      request: parseStoredRequest(row.request),
      response: parseStoredResult(row.response),
      inputMessageId: row.inputMessageId,
      assistantMessageId:
        typeof row.continuation.assistantMessageId === "string" ? row.continuation.assistantMessageId : null,
      errorMessage: row.errorMessage,
      ...(approvalView(row.continuation) ? { approval: approvalView(row.continuation) } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
  async function assistantAvailability(): Promise<AssistantAvailability> {
    const settings = await loadRuntimeSettings();
    try {
      const client = await createAIClient();
      const capabilities = client.getCapabilities();
      const enabled = settings["ai.enabled"].value === true && capabilities.configured;
      return {
        enabled,
        provider: client.provider,
        capabilities,
        reason: enabled ? undefined : "The assistant is not configured. Manual work remains available.",
      };
    } catch {
      return {
        enabled: false,
        provider: activeAIProvider(settings),
        capabilities: {
          images: false,
          structuredOutput: false,
          webSearch: false,
          urlRetrieval: false,
        },
        reason: "The configured AI provider is unavailable.",
      };
    }
  }
  async function requireAssistantClient(provider?: string) {
    const settings = await loadRuntimeSettings();
    if (settings["ai.enabled"].value !== true)
      throw new AssistantError("UNAVAILABLE", "The assistant is disabled. You can continue manually.", 503);
    const client = await createAIClient(provider);
    const caps = client.getCapabilities();
    if (!caps.configured)
      throw new AssistantError("UNAVAILABLE", "The provider is not configured for generation.", 503);
    return client;
  }
  async function requireResourceAccess(
    tx: AssistantTransaction,
    actor: string,
    resourceId: string | null,
    edit = false,
    operation?: string,
  ) {
    if (resourceId !== null) assistantResourceId.parse(resourceId);
    await integration.authorize(tx, actor, resourceId, edit, operation);
  }
  async function requireThread(
    tx: AssistantTransaction,
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    options: { edit?: boolean; operation?: string; forUpdate?: boolean } = {},
  ) {
    assistantId.parse(threadId);
    const query = tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.ownerId, actor), eq(threads.integrationKey, integration.key)));
    const [thread] = await (options.forUpdate ? query.for("update") : query);
    if (
      !thread ||
      (resourceId !== undefined && thread.resourceId !== resourceId) ||
      thread.updatedAt.getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000
    )
      throw new AssistantError("NOT_FOUND", "This private thread is no longer available.", 404);
    await requireResourceAccess(tx, actor, thread.resourceId, options.edit ?? false, options.operation);
    return thread;
  }
  async function listThreads(actor: string, resourceId: string | null) {
    return db.transaction(async (tx) => {
      await requireResourceAccess(tx, actor, resourceId);
      return (
        await tx
          .select()
          .from(threads)
          .where(
            and(
              eq(threads.ownerId, actor),
              eq(threads.integrationKey, integration.key),
              resourceId === null ? sql`${threads.resourceId} IS NULL` : eq(threads.resourceId, resourceId),
              sql`${threads.updatedAt} > now() - interval '30 days'`,
            ),
          )
          .orderBy(desc(threads.updatedAt))
      ).map(threadView);
    });
  }
  async function createThread(actor: string, resourceId: string | null | undefined, input: unknown) {
    const value = threadPatchSchema.pick({ title: true, settings: true }).parse(input);
    return db.transaction(async (tx) => {
      await requireResourceAccess(tx, actor, resourceId ?? null, true);
      const [thread] = await tx
        .insert(threads)
        .values({
          id: randomUUID(),
          ownerId: actor,
          resourceId: resourceId ?? null,
          integrationKey: integration.key,
          title: value.title ?? NEW_THREAD_TITLE,
          settings: { ...integration.defaultSettings, ...integration.validateSettings(value.settings ?? {}) },
        })
        .returning();
      return threadView(thread);
    });
  }
  async function getThread(actor: string, resourceId: string | null | undefined, threadId: string) {
    return db.transaction(async (tx) => {
      const thread = await requireThread(tx, actor, resourceId, threadId);
      const history = await tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.threadId, threadId),
            eq(runs.ownerId, actor),
            eq(runs.executionMode, "conversational"),
            sql`${runs.expiresAt} > now()`,
          ),
        )
        .orderBy(runs.updatedAt);
      const conversation = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            sql`NOT EXISTS (SELECT 1 FROM assistant_runs analysis WHERE analysis.thread_id = ${threadId} AND analysis.execution_mode = 'standalone' AND (analysis.id = ${messages.runId} OR analysis.input_message_id = ${messages.id}))`,
            sql`NOT EXISTS (SELECT 1 FROM assistant_runs expired WHERE expired.thread_id = ${threadId} AND expired.expires_at <= now() AND (expired.id = ${messages.runId} OR expired.input_message_id = ${messages.id}) AND NOT EXISTS (SELECT 1 FROM assistant_runs fresh WHERE fresh.input_message_id = expired.input_message_id AND fresh.expires_at > now()))`,
          ),
        )
        .orderBy(messages.updatedAt);
      const files = await tx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.threadId, threadId),
            eq(attachments.ownerId, actor),
            sql`${attachments.type} <> 'artifact'`,
            sql`${attachments.status} <> 'deleting'`,
          ),
        )
        .orderBy(attachments.createdAt);
      const selectedArtifactIds = [
        ...new Set([
          ...(threadView(thread).composerState?.attachmentIds ?? []),
          ...conversation.flatMap((message) =>
            message.parts.flatMap((part) => (part.type === "attachment" ? [part.attachmentId] : [])),
          ),
        ]),
      ];
      const selectedArtifacts = selectedArtifactIds.length
        ? await tx
            .select({
              id: attachments.id,
              threadId: attachments.threadId,
              messageId: attachments.messageId,
              runId: attachments.runId,
              ownerId: attachments.ownerId,
              type: attachments.type,
              label: attachments.label,
              status: attachments.status,
              expiresAt: attachments.expiresAt,
              createdAt: attachments.createdAt,
              updatedAt: attachments.updatedAt,
              data: sql<
                Record<string, unknown>
              >`jsonb_build_object('artifact', (${attachments.data}->'artifact') - 'content' - 'inputArtifactIds' - 'baseDocumentFingerprint')`,
            })
            .from(attachments)
            .where(
              and(
                eq(attachments.ownerId, actor),
                eq(attachments.threadId, threadId),
                eq(attachments.type, "artifact"),
                inArray(attachments.id, selectedArtifactIds),
                eq(attachments.status, "ready"),
                sql`${attachments.expiresAt} > now()`,
              ),
            )
        : [];
      const executionResults = await executionPage(tx, actor, threadId);
      return {
        thread: threadView(thread),
        runs: history.map(runView),
        messages: conversation.map(messageView),
        attachments: [...files, ...selectedArtifacts].map((file) => attachmentView(file)),
        executions: executionResults.executions,
        executionsCursor: executionResults.nextCursor,
        ...(await assistantAvailability()),
      };
    });
  }
  async function updateThread(actor: string, resourceId: string | null | undefined, threadId: string, input: unknown) {
    const value = threadPatchSchema.parse(input);
    return db.transaction(async (tx) => {
      const thread = await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
      if (value.activeVariant) {
        const { messageId, runId } = value.activeVariant;
        const [variant] = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              eq(runs.id, runId),
              eq(runs.threadId, threadId),
              eq(runs.inputMessageId, messageId),
              eq(runs.status, "completed"),
              sql`${runs.expiresAt} > now()`,
            ),
          );
        if (!variant) throw new AssistantError("NOT_FOUND", "That response is no longer available.", 404);
        await tx
          .update(messages)
          .set({ meta: sql`${messages.meta} || ${JSON.stringify({ activeRunId: runId })}::jsonb` })
          .where(and(eq(messages.id, messageId), eq(messages.threadId, threadId)));
      }
      const [updated] = await tx
        .update(threads)
        .set({
          title: value.title ?? thread.title,
          settings: {
            ...thread.settings,
            ...integration.validateSettings(value.settings ?? {}),
            ...(value.composerDraft === undefined ? {} : { composerDraft: value.composerDraft }),
            ...(value.composerState === undefined ? {} : { composerState: value.composerState }),
          },
          updatedAt: new Date(),
        })
        .where(eq(threads.id, threadId))
        .returning();
      return threadView(updated);
    });
  }
  /** Erase private content immediately; retain only provider cleanup references on failure. */
  async function removeThreadHistory(
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    removeThread = false,
  ) {
    const removed = await db.transaction(async (tx) => {
      const thread = await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
      const [upload] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.threadId, threadId), eq(attachments.status, "processing")))
        .limit(1);
      if (upload)
        throw new AssistantError(
          "CONFLICT",
          "Wait for the attachment upload to finish before clearing its resources.",
          409,
        );
      const files = await tx.select().from(attachments).where(eq(attachments.threadId, threadId));
      const history = await tx.select().from(runs).where(eq(runs.threadId, threadId));
      const expired = new Date(0);
      await tx.delete(attachments).where(and(eq(attachments.threadId, threadId), eq(attachments.type, "artifact")));
      await tx.update(attachments).set({ messageId: null }).where(eq(attachments.threadId, threadId));
      await tx.update(runs).set({ inputMessageId: null }).where(eq(runs.threadId, threadId));
      await tx.delete(messages).where(eq(messages.threadId, threadId));
      await tx
        .update(attachments)
        .set({ status: "deleting", expiresAt: expired, updatedAt: new Date() })
        .where(eq(attachments.threadId, threadId));
      for (const run of history)
        await tx
          .update(runs)
          .set({
            expiresAt: expired,
            request: {
              schemaVersion: 1,
              clientRequestId: run.clientRequestId,
              operation: run.operation,
              message: "Cleared content",
            },
            response: null,
            usage: null,
            errorMessage: null,
            continuation: {
              ...run.continuation,
              contentExpired: false,
              cleared: true,
              messages: [],
              calls: [],
              proposals: [],
              citations: [],
              retainUntil: run.continuation.retainUntil ?? run.expiresAt.toISOString(),
            },
          })
          .where(eq(runs.id, run.id));
      await tx
        .update(threads)
        .set({
          updatedAt: removeThread ? expired : new Date(),
          settings: removeThread ? {} : { ...thread.settings, composerDraft: "", composerState: { attachmentIds: [] } },
          ...(removeThread ? { title: "Deleted thread" } : {}),
        })
        .where(eq(threads.id, threadId));
      return { files: files.filter((file) => file.type !== "artifact"), history };
    });
    for (const file of removed.files) {
      try {
        const provider = attachmentProvider(file.data);
        if (provider) await (await createAIClient(provider.name)).deleteFile(provider.fileId);
        await db.delete(attachments).where(eq(attachments.id, file.id));
      } catch {
        /* Scheduled cleanup retries retained private file handles. */
      }
    }
    for (const run of removed.history) {
      try {
        await deleteRunResponses(run);
        await db.delete(runs).where(eq(runs.id, run.id));
      } catch {
        /* Content is erased; scheduled cleanup retries opaque response handles. */
      }
    }
    if (removeThread)
      await db
        .delete(threads)
        .where(
          and(
            eq(threads.id, threadId),
            sql`NOT EXISTS (SELECT 1 FROM assistant_runs WHERE thread_id = ${threadId}) AND NOT EXISTS (SELECT 1 FROM assistant_attachments WHERE thread_id = ${threadId})`,
          ),
        );
  }
  async function uploadAttachment(actor: string, resourceId: string | null | undefined, threadId: string, file: File) {
    if (file.name.length > 255 || !file.name.trim())
      throw new AssistantError("VALIDATION", "Choose an image with a valid filename.");
    if (file.size > 5 * 1024 * 1024) throw new AssistantError("VALIDATION", "Images must be at most 5 MiB.");
    const data = new Uint8Array(await file.arrayBuffer());
    validateAssistantImage(data, file.type);
    const client = await requireAssistantClient();
    if (!client.getCapabilities().images)
      throw new AssistantError("CAPABILITY", "This provider does not support images.");
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
      await tx.insert(attachments).values({
        id,
        threadId,
        ownerId: actor,
        type: "file",
        label: file.name,
        data: { mimeType: file.type, sizeBytes: file.size, provider: { name: client.provider } },
        status: "processing",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    });
    try {
      const uploaded = await client.uploadFile({ data, filename: file.name, mimeType: file.type });
      // Save the provider reference even if permissions changed during upload, so cleanup can delete it.
      await db
        .update(attachments)
        .set({
          data: {
            mimeType: file.type,
            sizeBytes: file.size,
            provider: { name: client.provider, fileId: uploaded.id, details: {} },
          },
          updatedAt: new Date(),
        })
        .where(eq(attachments.id, id));
      return await db.transaction(async (tx) => {
        await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
        const [row] = await tx
          .update(attachments)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(attachments.id, id))
          .returning();
        return attachmentView(row);
      });
    } catch (error) {
      await db.update(attachments).set({ status: "failed", updatedAt: new Date() }).where(eq(attachments.id, id));
      throw error;
    }
  }
  async function removeAttachment(actor: string, resourceId: string | null | undefined, threadId: string, id: string) {
    assistantId.parse(id);
    const file = await db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
      const [row] = await tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), eq(attachments.threadId, threadId), eq(attachments.ownerId, actor)))
        .for("update");
      if (!row) throw new AssistantError("NOT_FOUND", "Attachment not found.", 404);
      if (row.messageId || row.type === "artifact")
        throw new AssistantError(
          "CONFLICT",
          "Sent attachments belong to message history. Clear the thread to remove them.",
          409,
        );
      if (row.status === "processing")
        throw new AssistantError("CONFLICT", "Wait for attachment preparation to finish.", 409);
      await tx.update(attachments).set({ status: "deleting", updatedAt: new Date() }).where(eq(attachments.id, id));
      return row;
    });
    const provider = attachmentProvider(file.data);
    if (provider) await (await createAIClient(provider.name)).deleteFile(provider.fileId);
    await db.transaction(async (tx) => {
      await tx.delete(attachments).where(eq(attachments.id, id));
    });
  }
  async function attachmentsForRun(
    tx: AssistantTransaction,
    actor: string,
    threadId: string,
    provider: string,
    ids: string[],
    inputMessageId?: string,
    agentInput = false,
  ) {
    if (!ids.length) return [];
    const files = await tx
      .select()
      .from(attachments)
      .where(and(inArray(attachments.id, ids), eq(attachments.threadId, threadId), eq(attachments.ownerId, actor)))
      .for("update");
    if (
      files.length !== ids.length ||
      files.some(
        (f) =>
          f.status !== "ready" ||
          (f.expiresAt !== null && f.expiresAt.getTime() <= Date.now()) ||
          (!agentInput && f.type !== "artifact" && f.messageId !== null && f.messageId !== inputMessageId) ||
          (f.type === "file" && attachmentProvider(f.data)?.name !== provider) ||
          (f.type === "link" && !z.object({ url: z.string() }).safeParse(f.data).success) ||
          (f.type === "artifact" && !integration.isArtifact(f.data.artifact)) ||
          !["file", "link", "artifact"].includes(f.type),
      )
    )
      throw new AssistantError(
        "VALIDATION",
        "An attachment is unavailable or belongs to another provider. Upload it again in this thread.",
      );
    for (const file of files) if (file.type === "link") publicReference(String(file.data.url));
    await tx
      .update(attachments)
      .set({ expiresAt: privateExpiry() })
      .where(
        and(
          inArray(attachments.id, ids),
          sql`${attachments.expiresAt} IS NOT NULL`,
          sql`${attachments.type} <> 'artifact'`,
        ),
      );
    return files;
  }

  async function createLinkAttachment(
    actor: string,
    resourceId: string | null | undefined,
    threadId: string,
    input: unknown,
  ) {
    const value = z
      .object({
        type: z.literal("link"),
        label: z.string().trim().min(1).max(255).optional(),
        url: z.string().max(2048),
      })
      .strict()
      .parse(input);
    const url = publicReference(value.url);
    return db.transaction(async (tx) => {
      await requireThread(tx, actor, resourceId, threadId, { edit: true, forUpdate: true });
      const [row] = await tx
        .insert(attachments)
        .values({
          id: randomUUID(),
          threadId,
          ownerId: actor,
          type: "link",
          label: value.label ?? new URL(url).hostname,
          data: { url },
          status: "ready",
        })
        .returning();
      return attachmentView(row);
    });
  }

  return {
    threadView,
    attachmentView,
    executionView,
    getThreadExecutions,
    listThreadAttachments,
    getThreadAttachment,
    messageView,
    runView,
    assistantAvailability,
    requireAssistantClient,
    requireResourceAccess,
    requireThread,
    listThreads,
    createThread,
    getThread,
    updateThread,
    removeThreadHistory,
    uploadAttachment,
    removeAttachment,
    attachmentsForRun,
    createLinkAttachment,
  };
}
export type AssistantThreads = ReturnType<typeof createAssistantThreads>;
