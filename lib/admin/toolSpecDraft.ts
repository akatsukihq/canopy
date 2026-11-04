/**
 * The unpublished half of a tool spec.
 *
 * `managed_tools.spec` is what visitors get; `spec_draft` is an admin's edit of
 * it. Saving validates and stores the draft, publishing copies it to `spec`
 * (and refreshes the English source messages), discarding clears it.
 */
import { db, eq, managedToolsTable, toolContentTable } from "../../db/index.ts";
import { CACHE_NAMESPACES } from "../cache/index.ts";
import { specFromRow } from "../tool-framework/catalog.ts";
import {
  getToolForUpdate,
  invalidateAfterCommit,
  requireTransactionPermission,
  synchronizeEnglishSource,
  toolTranslationSource,
  validatedToolSpec,
  writeAudit,
  type Transaction,
} from "./adminMutations.ts";

export { ToolSpecValidationError } from "./adminMutations.ts";

type DraftResult = { updatedAt: string };

const clearCatalog = <T>(result: T): Promise<T> => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result);

/** Locks the row, checks permission, and rejects an edit made against an older copy. */
async function lockFresh(transaction: Transaction, actorUserId: string, toolId: string, updatedAt: unknown) {
  await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
  const current = await getToolForUpdate(transaction, toolId);
  if (typeof updatedAt !== "string" || current.updatedAt.toISOString() !== updatedAt) {
    throw new Error("This tool changed after you opened it. Reload the page before saving again.");
  }
  // Strictly later, so the next stale check always sees a different value.
  const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
  return { current, now };
}

export async function saveToolSpecDraft(
  actorUserId: string,
  toolId: string,
  input: { spec: unknown; updatedAt: string },
): Promise<DraftResult> {
  return db
    .transaction(async (transaction) => {
      const { current, now } = await lockFresh(transaction, actorUserId, toolId, input?.updatedAt);
      await validatedToolSpec(input.spec, current);
      await transaction
        .update(managedToolsTable)
        .set({ specDraft: input.spec, updatedAt: now })
        .where(eq(managedToolsTable.toolId, toolId));
      await writeAudit(transaction, actorUserId, "tool.spec-draft-save", "tool", toolId, {});
      return { updatedAt: now.toISOString() };
    })
    .then(clearCatalog);
}

export async function publishToolSpecDraft(
  actorUserId: string,
  toolId: string,
  input: { updatedAt: string },
): Promise<DraftResult> {
  return db
    .transaction(async (transaction) => {
      const { current, now } = await lockFresh(transaction, actorUserId, toolId, input?.updatedAt);
      if (current.specDraft == null) throw new Error("There is no spec draft to publish.");
      const next = await validatedToolSpec(current.specDraft, current);

      let translations = current.translations;
      if (translations?.en) {
        const [content] = await transaction
          .select()
          .from(toolContentTable)
          .where(eq(toolContentTable.toolId, toolId))
          .limit(1)
          .for("update");
        translations = synchronizeEnglishSource(
          translations,
          toolTranslationSource(await specFromRow(current), current, content ?? null),
          toolTranslationSource(next, current, content ?? null),
        );
      }

      await transaction
        .update(managedToolsTable)
        .set({ spec: current.specDraft, specDraft: null, translations, updatedAt: now })
        .where(eq(managedToolsTable.toolId, toolId));
      await writeAudit(transaction, actorUserId, "tool.spec-publish", "tool", toolId, {});
      return { updatedAt: now.toISOString() };
    })
    .then(clearCatalog);
}

export async function discardToolSpecDraft(
  actorUserId: string,
  toolId: string,
  input: { updatedAt: string },
): Promise<DraftResult> {
  return db
    .transaction(async (transaction) => {
      const { now } = await lockFresh(transaction, actorUserId, toolId, input?.updatedAt);
      await transaction
        .update(managedToolsTable)
        .set({ specDraft: null, updatedAt: now })
        .where(eq(managedToolsTable.toolId, toolId));
      await writeAudit(transaction, actorUserId, "tool.spec-draft-discard", "tool", toolId, {});
      return { updatedAt: now.toISOString() };
    })
    .then(clearCatalog);
}
