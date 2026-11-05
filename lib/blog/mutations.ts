import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getTableColumns } from "drizzle-orm";
import { AuthorizationError } from "../admin/index.ts";
import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  sql,
  blogPostsTable as posts,
  blogRevisionsTable as revisions,
  blogPostSchedulesTable as schedules,
  blogCategoriesTable as categories,
  blogTagsTable as tags,
  blogPublishedPostTagsTable as publishedTags,
  managedToolsTable,
} from "../../db/index.ts";
import { requireTransactionPermission, writeAudit } from "../admin/adminMutations.ts";
import {
  assertBlogPublishable,
  assertBlogTitleWordLimit,
  blogDocumentHash,
  blogDocumentText,
  blogSlugFromTitle,
  createBlogDocument,
  validateBlogDocument,
  BlogValidationError,
  type BlogDocument,
} from "./document.ts";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Post = typeof posts.$inferSelect;
type Revision = typeof revisions.$inferSelect;
const identity = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const postInput = z.object({ postId: identity, version: z.number().int().positive().max(2147483646) }).strict();

export class BlogError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "VALIDATION";
  constructor(code: "NOT_FOUND" | "CONFLICT" | "VALIDATION", message: string) {
    super(message);
    this.name = "BlogError";
    this.code = code;
  }
}

async function databaseNow(tx: Pick<Transaction, "execute">): Promise<Date> {
  const {
    rows: [row],
  } = await tx.execute<{ now: string | Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(row.now);
}

async function lockPost(tx: Transaction, input: z.infer<typeof postInput>, allowTrash = false) {
  const [post] = await tx.select().from(posts).where(eq(posts.id, input.postId)).for("update");
  if (!post) throw new BlogError("NOT_FOUND", "Article not found.");
  if (post.version !== input.version)
    throw new BlogError("CONFLICT", "This article changed. Reload the latest version before saving.");
  if (post.trashedAt && !allowTrash) throw new BlogError("VALIDATION", "Restore this article from trash first.");
  return post;
}

/** References are catalog IDs; labels supplied by clients never become authoritative. */
async function resolveDocument(tx: Transaction, input: unknown, publishing = false): Promise<BlogDocument> {
  const document = validateBlogDocument(input);
  assertBlogTitleWordLimit(document.title);
  if (document.category) {
    const [category] = await tx.select().from(categories).where(eq(categories.id, document.category.id));
    if (!category) throw new BlogError("VALIDATION", "Choose an existing category.");
    document.category = { id: category.id, label: category.name };
  }
  if (document.tags.length) {
    const terms = await tx
      .select()
      .from(tags)
      .where(
        inArray(
          tags.id,
          document.tags.map((tag) => tag.id),
        ),
      );
    if (terms.length !== document.tags.length) throw new BlogError("VALIDATION", "Choose existing tags.");
    document.tags = document.tags.map((tag) => ({
      id: tag.id,
      label: terms.find((term) => term.id === tag.id)!.name,
    }));
  }
  if (document.relatedToolIds.length) {
    const tools = await tx
      .select({ id: managedToolsTable.toolId })
      .from(managedToolsTable)
      .where(inArray(managedToolsTable.toolId, document.relatedToolIds));
    if (tools.length !== document.relatedToolIds.length)
      throw new BlogError("VALIDATION", "Choose existing related tools.");
  }
  const normalized = validateBlogDocument(document);
  if (publishing) assertBlogPublishable(normalized);
  return normalized;
}

async function checkpoint(
  tx: Transaction,
  post: Post,
  actor: string,
  reason: Revision["reason"],
  now: Date,
  sourceRevisionId?: string,
): Promise<Revision> {
  const [latest] = await tx
    .select()
    .from(revisions)
    .where(eq(revisions.postId, post.id))
    .orderBy(desc(revisions.revisionNumber))
    .limit(1);
  if (reason !== "restore" && latest?.contentHash === post.draftHash) return latest;
  const [revision] = await tx
    .insert(revisions)
    .values({
      id: randomUUID(),
      postId: post.id,
      revisionNumber: post.revisionSequence + 1,
      document: post.draftDocument,
      contentHash: post.draftHash,
      reason,
      sourceRevisionId,
      createdBy: actor,
      createdAt: now,
    })
    .returning();
  post.revisionSequence += 1;
  post.lastCheckpointAt = now;
  await tx
    .update(posts)
    .set({ revisionSequence: post.revisionSequence, lastCheckpointAt: now })
    .where(eq(posts.id, post.id));
  return revision;
}

async function insertPost(
  tx: Transaction,
  actor: string,
  document: BlogDocument,
  duplicatedFrom?: string,
): Promise<Post> {
  const base = blogSlugFromTitle(document.title);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 151).replace(/-+$/, "")}-${randomBytes(4).toString("hex")}`;
    const [post] = await tx
      .insert(posts)
      .values({
        id: randomUUID(),
        slug,
        draftDocument: document,
        draftHash: blogDocumentHash(document),
        createdBy: actor,
        draftUpdatedBy: actor,
      })
      .onConflictDoNothing({ target: posts.slug })
      .returning();
    if (!post) continue;
    await checkpoint(tx, post, actor, "create", await databaseNow(tx));
    await writeAudit(tx, actor, duplicatedFrom ? "blog.duplicate" : "blog.create", "blog_post", post.id, {
      duplicatedFrom,
      slug,
    });
    return post;
  }
  throw new BlogError("CONFLICT", "Could not allocate an article URL. Try again.");
}

/** Shared by durable generation so the draft and its run commit atomically. */
export async function createBlogPostInTransaction(tx: Transaction, actor: string, input: unknown): Promise<Post> {
  await requireTransactionPermission(tx, actor, "blog", "create");
  return insertPost(tx, actor, await resolveDocument(tx, input));
}

export async function createBlogPost(actor: string, input: unknown): Promise<Post> {
  const { title } = z
    .object({ title: z.string().trim().min(1).max(200) })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "create");
    return insertPost(tx, actor, createBlogDocument(title));
  });
}

export async function duplicateBlogPost(actor: string, input: unknown): Promise<Post> {
  const { postId } = z.object({ postId: identity }).strict().parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "create");
    await requireTransactionPermission(tx, actor, "blog", "view");
    const [source] = await tx.select().from(posts).where(eq(posts.id, postId)).for("share");
    if (!source) throw new BlogError("NOT_FOUND", "Article not found.");
    return insertPost(tx, actor, await resolveDocument(tx, source.draftDocument), source.id);
  });
}

export async function saveBlogDraft(actor: string, input: unknown): Promise<Post> {
  const value = postInput
    .extend({ document: z.unknown(), mode: z.enum(["autosave", "manual"]).default("autosave") })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "edit");
    const post = await lockPost(tx, value);
    const document = await resolveDocument(tx, value.document);
    const hash = blogDocumentHash(document);
    const now = await databaseNow(tx);
    const changed = hash !== post.draftHash;
    if (changed) {
      Object.assign(post, {
        draftDocument: document,
        draftHash: hash,
        draftUpdatedAt: now,
        draftUpdatedBy: actor,
        updatedAt: now,
        version: post.version + 1,
      });
      await tx
        .update(posts)
        .set({
          draftDocument: document,
          draftHash: hash,
          draftUpdatedAt: now,
          draftUpdatedBy: actor,
          updatedAt: now,
          version: post.version,
        })
        .where(eq(posts.id, post.id));
    }
    const before = post.revisionSequence;
    if (
      value.mode === "manual" ||
      (changed && (!post.lastCheckpointAt || now.getTime() - post.lastCheckpointAt.getTime() >= 60000))
    ) {
      await checkpoint(tx, post, actor, value.mode === "manual" ? "manual_save" : "autosave", now);
    }
    if (changed || before !== post.revisionSequence) {
      await writeAudit(tx, actor, "blog.save", "blog_post", post.id, {
        version: post.version,
        mode: value.mode,
        revisionNumber: post.revisionSequence,
      });
    }
    return post;
  });
}

async function removeSchedule(tx: Transaction, postId: string, actor: string, reason: string) {
  const removed = await tx.delete(schedules).where(eq(schedules.postId, postId)).returning();
  for (const request of removed)
    await writeAudit(tx, actor, "blog.schedule.cancel", "blog_post", postId, {
      scheduleId: request.id,
      revisionId: request.revisionId,
      scheduledAt: request.scheduledAt.toISOString(),
      reason,
    });
  return removed.length > 0;
}

async function promote(
  tx: Transaction,
  post: Post,
  revision: Revision,
  actor: string,
  now: Date,
  schedule?: { id: string; scheduledAt: Date },
): Promise<Post> {
  // Validate stored content again; never replace the working draft with this frozen revision.
  const document = await resolveDocument(tx, revision.document, true);
  if (revision.postId !== post.id) throw new BlogError("VALIDATION", "Revision does not belong to this article.");
  if (!schedule) await removeSchedule(tx, post.id, actor, "publish_now");
  else await tx.delete(schedules).where(and(eq(schedules.id, schedule.id), eq(schedules.postId, post.id)));
  const [saved] = await tx
    .update(posts)
    .set({
      publishedRevisionId: revision.id,
      publishedCategoryId: document.category!.id,
      publishedSearch: sql`setweight(to_tsvector('english', ${document.title}), 'A') || setweight(to_tsvector('english', ${document.excerpt}), 'B') || to_tsvector('english', ${blogDocumentText(document)})`,
      firstPublishedAt: post.firstPublishedAt ?? now,
      publishedUpdatedAt: post.publishedRevisionId === revision.id ? (post.publishedUpdatedAt ?? now) : now,
      version: post.version + 1,
      updatedAt: now,
    })
    .where(eq(posts.id, post.id))
    .returning();
  await tx.delete(publishedTags).where(eq(publishedTags.postId, post.id));
  if (document.tags.length)
    await tx.insert(publishedTags).values(document.tags.map((tag) => ({ postId: post.id, tagId: tag.id })));
  await writeAudit(tx, actor, "blog.publish", "blog_post", post.id, {
    revisionId: revision.id,
    scheduleId: schedule?.id,
    scheduledAt: schedule?.scheduledAt.toISOString(),
  });
  return saved;
}

export async function publishBlogPost(actor: string, input: unknown): Promise<Post> {
  const value = postInput.parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "publish");
    const post = await lockPost(tx, value);
    await resolveDocument(tx, post.draftDocument, true);
    const now = await databaseNow(tx);
    const revision = await checkpoint(tx, post, actor, "publish", now);
    return promote(tx, post, revision, actor, now);
  });
}

export async function scheduleBlogPost(actor: string, input: unknown) {
  const value = postInput
    .extend({ scheduledAt: z.string().datetime({ offset: true }) })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "publish");
    const post = await lockPost(tx, value);
    const now = await databaseNow(tx);
    const scheduledAt = new Date(value.scheduledAt);
    if (scheduledAt <= now) throw new BlogError("VALIDATION", "Choose a future publication time.");
    await resolveDocument(tx, post.draftDocument, true);
    const revision = await checkpoint(tx, post, actor, "schedule", now);
    await removeSchedule(tx, post.id, actor, "replace");
    const scheduleId = randomUUID();
    const [schedule] = await tx
      .insert(schedules)
      .values({
        id: scheduleId,
        postId: post.id,
        revisionId: revision.id,
        scheduledAt,
        scheduledBy: actor,
        createdAt: now,
      })
      .returning();
    const [saved] = await tx
      .update(posts)
      .set({ version: post.version + 1, updatedAt: now })
      .where(eq(posts.id, post.id))
      .returning();
    await writeAudit(tx, actor, "blog.schedule", "blog_post", post.id, {
      scheduleId,
      revisionId: revision.id,
      scheduledAt: scheduledAt.toISOString(),
    });
    return { ...saved, schedule };
  });
}

export async function retryBlogSchedule(actor: string, input: unknown): Promise<Post> {
  const value = postInput.parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "publish");
    const [candidate] = await tx.select().from(schedules).where(eq(schedules.postId, value.postId));
    if (!candidate) throw new BlogError("NOT_FOUND", "Scheduled publication not found.");
    if (!candidate.scheduledBy)
      throw new AuthorizationError("Scheduling account no longer exists. Reschedule this article.");
    // Authorization rows precede the post lock, including the original publisher's rows.
    if (candidate.scheduledBy !== actor)
      await requireTransactionPermission(tx, candidate.scheduledBy, "blog", "publish");
    const post = await lockPost(tx, value);
    const [request] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.postId, post.id), eq(schedules.id, candidate.id)))
      .for("update");
    if (!request || request.scheduledBy !== candidate.scheduledBy) {
      throw new BlogError("CONFLICT", "The publication schedule changed. Reload the article before retrying.");
    }
    const now = await databaseNow(tx);
    if (request.scheduledAt > now) throw new BlogError("VALIDATION", "This article is scheduled for a future time.");
    const [revision] = await tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.id, request.revisionId), eq(revisions.postId, post.id)));
    if (!revision) throw new BlogError("NOT_FOUND", "Scheduled revision no longer exists.");
    return promote(tx, post, revision, actor, now, request);
  });
}

async function lifecycle(
  actor: string,
  input: unknown,
  operation: "cancel_schedule" | "unpublish" | "trash" | "restore_trash",
): Promise<Post> {
  const value = postInput.parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(
      tx,
      actor,
      "blog",
      operation === "trash" || operation === "restore_trash" ? "archive" : "publish",
    );
    const post = await lockPost(tx, value, operation === "restore_trash");
    // This actor's authorization rows are already shared-locked above.
    if (operation === "trash" && post.publishedRevisionId)
      await requireTransactionPermission(tx, actor, "blog", "publish");
    const now = await databaseNow(tx);
    if (operation === "restore_trash" && !post.trashedAt) return post;
    const cancelled = operation !== "restore_trash" && (await removeSchedule(tx, post.id, actor, operation));
    if (operation === "cancel_schedule" && !cancelled) return post;
    if (operation === "unpublish" && !post.publishedRevisionId && !cancelled) return post;
    const clearLive = operation === "unpublish" || operation === "trash";
    if (clearLive) await tx.delete(publishedTags).where(eq(publishedTags.postId, post.id));
    const [saved] = await tx
      .update(posts)
      .set({
        ...(clearLive ? { publishedRevisionId: null, publishedCategoryId: null, publishedSearch: null } : {}),
        ...(operation === "trash" ? { trashedAt: now } : operation === "restore_trash" ? { trashedAt: null } : {}),
        version: post.version + 1,
        updatedAt: now,
      })
      .where(eq(posts.id, post.id))
      .returning();
    await writeAudit(tx, actor, `blog.${operation}`, "blog_post", post.id, {
      version: saved.version,
    });
    return saved;
  });
}

export const cancelBlogSchedule = (actor: string, input: unknown) => lifecycle(actor, input, "cancel_schedule");
export const unpublishBlogPost = (actor: string, input: unknown) => lifecycle(actor, input, "unpublish");
export const trashBlogPost = (actor: string, input: unknown) => lifecycle(actor, input, "trash");
export const restoreTrashedBlogPost = (actor: string, input: unknown) => lifecycle(actor, input, "restore_trash");

export async function restoreBlogRevision(actor: string, input: unknown): Promise<Post> {
  const value = postInput.extend({ revisionId: identity }).strict().parse(input);
  return db.transaction(async (tx) => {
    await requireTransactionPermission(tx, actor, "blog", "edit");
    const post = await lockPost(tx, value);
    const [source] = await tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.id, value.revisionId), eq(revisions.postId, post.id)));
    if (!source) throw new BlogError("NOT_FOUND", "Revision not found.");
    // Keep historical labels intact; resolving checks that the referenced catalog entries still exist.
    await resolveDocument(tx, source.document);
    const document = validateBlogDocument(source.document);
    const now = await databaseNow(tx);
    await checkpoint(tx, post, actor, "restore_backup", now);
    Object.assign(post, {
      draftDocument: document,
      draftHash: blogDocumentHash(document),
      draftUpdatedBy: actor,
      draftUpdatedAt: now,
      version: post.version + 1,
      updatedAt: now,
    });
    await tx
      .update(posts)
      .set({
        draftDocument: document,
        draftHash: post.draftHash,
        draftUpdatedBy: actor,
        draftUpdatedAt: now,
        version: post.version,
        updatedAt: now,
      })
      .where(eq(posts.id, post.id));
    const restored = await checkpoint(tx, post, actor, "restore", now, source.id);
    await writeAudit(tx, actor, "blog.restore_revision", "blog_post", post.id, {
      sourceRevisionId: source.id,
      revisionId: restored.id,
    });
    return post;
  });
}

export async function saveBlogTerm(actor: string, input: unknown) {
  const value = z
    .object({
      kind: z.enum(["category", "tag"]),
      id: identity.optional(),
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .refine(
          (name) => name.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(name),
          "Use a name without control characters.",
        ),
    })
    .strict()
    .parse(input);
  const table = value.kind === "category" ? categories : tags;
  return db
    .transaction(async (tx) => {
      await requireTransactionPermission(tx, actor, "blog", "edit");
      if (value.id) {
        const [existing] = await tx.select().from(table).where(eq(table.id, value.id)).for("update");
        if (!existing) throw new BlogError("NOT_FOUND", "Category or tag not found.");
        if (existing.name === value.name) return existing;
        const [conflict] = await tx
          .select({ id: table.id })
          .from(table)
          .where(sql`lower(${table.name}) = lower(${value.name}) AND ${table.id} <> ${value.id}`);
        if (conflict) throw new BlogError("CONFLICT", "A category or tag with this name already exists.");
        const [saved] = await tx
          .update(table)
          .set({ name: value.name, updatedBy: actor, updatedAt: await databaseNow(tx) })
          .where(eq(table.id, value.id))
          .returning();
        await writeAudit(tx, actor, `blog.${value.kind}.edit`, `blog_${value.kind}`, saved.id);
        return saved;
      }
      const base = blogSlugFromTitle(value.name);
      for (let attempt = 0; attempt < 5; attempt++) {
        const slug =
          attempt === 0 ? base : `${base.slice(0, 151).replace(/-+$/, "")}-${randomBytes(4).toString("hex")}`;
        const [saved] = await tx
          .insert(table)
          .values({ id: randomUUID(), name: value.name, slug, createdBy: actor, updatedBy: actor })
          .onConflictDoNothing()
          .returning();
        if (saved) {
          await writeAudit(tx, actor, `blog.${value.kind}.create`, `blog_${value.kind}`, saved.id);
          return saved;
        }
        const [conflict] = await tx
          .select({ id: table.id })
          .from(table)
          .where(sql`lower(${table.name}) = lower(${value.name})`);
        if (conflict) throw new BlogError("CONFLICT", "A category or tag with this name already exists.");
      }
      throw new BlogError("CONFLICT", "Could not allocate the category or tag URL. Try again.");
    })
    .catch((error: unknown) => {
      const code =
        (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
      if (code === "23505") throw new BlogError("CONFLICT", "A category or tag with this name already exists.");
      throw error;
    });
}

export async function publishDueBlogPosts() {
  const started = Date.now();
  const cutoff = await databaseNow(db);
  const result = { attempted: 0, published: 0, failed: 0, remaining: 0 };
  const attemptedPosts = new Set<string>();
  let cursor: { at: string; id: string } | undefined;
  while (Date.now() - started < 20000) {
    const candidates = await db
      .select({
        ...getTableColumns(schedules),
        cursorTime: sql<string>`to_char(${schedules.scheduledAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(schedules)
      .where(
        and(
          sql`${schedules.scheduledAt} <= ${cutoff}`,
          cursor
            ? sql`(${schedules.scheduledAt}, ${schedules.id}) > (${cursor.at}::timestamptz, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(schedules.scheduledAt), asc(schedules.id))
      .limit(50);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      if (Date.now() - started >= 20000) break;
      cursor = { at: candidate.cursorTime, id: candidate.id };
      if (attemptedPosts.has(candidate.postId)) continue;
      attemptedPosts.add(candidate.postId);
      result.attempted++;
      try {
        const published = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
          if (!candidate.scheduledBy) throw new AuthorizationError("Scheduling account no longer exists.");
          // All writers lock authorization rows before the post, and the post before its schedule.
          await requireTransactionPermission(tx, candidate.scheduledBy, "blog", "publish");
          const [post] = await tx
            .select()
            .from(posts)
            .where(eq(posts.id, candidate.postId))
            .for("update", { skipLocked: true });
          if (!post || post.trashedAt) return false;
          const [request] = await tx
            .select()
            .from(schedules)
            .where(and(eq(schedules.postId, post.id), eq(schedules.id, candidate.id)))
            .for("update");
          if (!request || request.scheduledAt > cutoff || request.scheduledBy !== candidate.scheduledBy) return false;
          const [revision] = await tx
            .select()
            .from(revisions)
            .where(and(eq(revisions.id, request.revisionId), eq(revisions.postId, post.id)));
          if (!revision) throw new BlogError("NOT_FOUND", "Scheduled revision no longer exists.");
          await promote(tx, post, revision, candidate.scheduledBy, await databaseNow(tx), request);
          return true;
        });
        if (published) result.published++;
      } catch (error) {
        result.failed++;
        const code =
          error instanceof AuthorizationError
            ? "PUBLISHER_FORBIDDEN"
            : error instanceof BlogValidationError || error instanceof BlogError
              ? "INVALID_CONTENT"
              : "TEMPORARY_FAILURE";
        // Identity, not post ID: a failed old request must never poison a replacement.
        try {
          await db
            .update(schedules)
            .set({ lastAttemptAt: sql`clock_timestamp()`, lastErrorCode: code })
            .where(eq(schedules.id, candidate.id));
        } catch {
          console.warn("blog.schedule.diagnostics_failed", {
            postId: candidate.postId,
            scheduleId: candidate.id,
            code,
          });
        }
      }
    }
    if (candidates.length < 50) break;
  }
  const [remaining] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(schedules)
    .where(sql`${schedules.scheduledAt} <= ${cutoff}`);
  result.remaining = remaining.count;
  return result;
}
