import {
  and,
  db,
  eq,
  sql,
  assistantRunsTable as runs,
  assistantAttachmentsTable as attachments,
  assistantThreadsTable as threads,
  assistantMessagesTable as messages,
} from "../../db/index.ts";
import { createAIClient } from "../config/integrations.ts";
import { attachmentProvider, deleteRunResponses } from "./resources.ts";

/** Expire private content/resources, retaining execution and usage records for reporting. */
export async function cleanupAssistant() {
  const deadline = Date.now() + 8_000;
  const counts = { files: 0, runs: 0, failed: 0 };
  const files = await db
    .select()
    .from(attachments)
    .where(sql`${attachments.expiresAt} <= now() OR ${attachments.status} = 'deleting'`)
    .orderBy(attachments.expiresAt)
    .limit(20);
  for (const file of files) {
    if (Date.now() > deadline) break;
    try {
      const reserved = await db.transaction(async (tx) => {
        await tx.select({ id: threads.id }).from(threads).where(eq(threads.id, file.threadId)).for("update");
        const [current] = await tx.select().from(attachments).where(eq(attachments.id, file.id)).for("update");
        if (
          !current ||
          (current.status !== "deleting" && (!current.expiresAt || current.expiresAt.getTime() > Date.now()))
        )
          return null;
        if (current.type === "artifact") {
          await tx.delete(attachments).where(eq(attachments.id, file.id));
          return null;
        }
        await tx
          .update(attachments)
          .set({ status: "deleting", updatedAt: new Date() })
          .where(eq(attachments.id, file.id));
        return current;
      });
      if (!reserved) continue;
      const provider = attachmentProvider(reserved.data);
      if (provider) await (await createAIClient(provider.name)).deleteFile(provider.fileId);
      await db.delete(attachments).where(and(eq(attachments.id, file.id), eq(attachments.status, "deleting")));
      counts.files++;
    } catch {
      counts.failed++;
    }
  }
  const expired = await db
    .select()
    .from(runs)
    .where(sql`${runs.expiresAt} <= now() AND coalesce(${runs.continuation}->>'contentExpired','false') <> 'true'`)
    .orderBy(runs.expiresAt)
    .limit(20);
  for (const run of expired) {
    if (Date.now() > deadline) break;
    try {
      const current = await db.transaction(async (tx) => {
        if (run.threadId)
          await tx.select({ id: threads.id }).from(threads).where(eq(threads.id, run.threadId)).for("update");
        const [locked] = await tx.select().from(runs).where(eq(runs.id, run.id)).for("update");
        if (!locked || locked.expiresAt.getTime() > Date.now() || locked.continuation.contentExpired === true)
          return null;
        await tx.delete(attachments).where(and(eq(attachments.runId, locked.id), eq(attachments.type, "artifact")));
        const now = new Date();
        await tx
          .update(runs)
          .set({
            // An expired uncertain request is still uncertain; do not invent cancellation.
            request: {
              schemaVersion: 1,
              clientRequestId: locked.clientRequestId,
              operation: locked.operation,
              message: locked.request.message === "Cleared content" ? "Cleared content" : "Expired content",
            },
            response: null,
            errorMessage: null,
            continuation: { ...locked.continuation, messages: [], calls: [], proposals: [], citations: [] },
          })
          .where(eq(runs.id, locked.id));
        await tx.update(messages).set({ parts: [] }).where(eq(messages.runId, locked.id));
        if (locked.inputMessageId)
          await tx
            .update(messages)
            .set({ parts: [], meta: {} })
            .where(
              and(
                eq(messages.id, locked.inputMessageId),
                sql`NOT EXISTS (SELECT 1 FROM assistant_runs r WHERE r.input_message_id = ${locked.inputMessageId} AND r.expires_at > ${now})`,
              ),
            );
        return locked;
      });
      if (!current) continue;
      await deleteRunResponses(current);
      if (current.request.message === "Cleared content") {
        // Explicit history deletion removes metrics too; ordinary retention does not.
        await db.delete(runs).where(eq(runs.id, current.id));
      } else {
        await db
          .update(runs)
          .set({
            providerResponseId: null,
            continuation: sql`${runs.continuation} || '{"contentExpired":true,"providerDeleted":true,"handles":[]}'::jsonb`,
          })
          .where(eq(runs.id, current.id));
      }
      counts.runs++;
    } catch {
      counts.failed++;
    }
  }
  // Cleanup retained provider handles; completion delivery never polls here.
  const pending = await db
    .select()
    .from(runs)
    .where(
      sql`${runs.expiresAt} > now() AND ${runs.status} IN ('completed','failed','cancelled') AND coalesce(${runs.continuation}->>'providerDeleted','false') <> 'true'`,
    )
    .orderBy(runs.updatedAt)
    .limit(10);
  for (const run of pending) {
    if (Date.now() > deadline) break;
    try {
      await deleteRunResponses(run);
      await db
        .update(runs)
        .set({ continuation: sql`${runs.continuation} || '{"providerDeleted":true}'::jsonb` })
        .where(eq(runs.id, run.id));
    } catch {
      counts.failed++;
    }
  }
  // Retained execution metrics can keep a thread row alive after its private content expires.
  // Do not extend its activity timestamp when erasing unsent drafts and integration settings.
  await db
    .update(threads)
    .set({ settings: {} })
    .where(sql`${threads.updatedAt} <= now() - interval '30 days' AND ${threads.settings} <> '{}'::jsonb`);
  await db
    .delete(threads)
    .where(
      sql`${threads.updatedAt} <= now() - interval '30 days' AND NOT EXISTS (SELECT 1 FROM assistant_runs WHERE thread_id = ${threads.id}) AND NOT EXISTS (SELECT 1 FROM assistant_attachments WHERE thread_id = ${threads.id}) AND NOT EXISTS (SELECT 1 FROM assistant_messages WHERE thread_id = ${threads.id})`,
    );
  return counts;
}
