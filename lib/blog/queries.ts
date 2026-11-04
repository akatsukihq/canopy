import config from "../config/config.ts";
import { loadRuntimeSettings } from "../config/runtimeSettings.ts";
import { and, desc, eq, exists, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  alias,
  authUser,
  blogCategoriesTable as categories,
  blogPostsTable as posts,
  blogPostSchedulesTable as schedules,
  blogPublishedPostTagsTable as postTags,
  blogRevisionsTable as revisions,
  assistantRunsTable as runs,
  blogTagsTable as tags,
  managedToolsTable,
  db,
} from "../../db/index.ts";
import { z } from "zod";
import { isValidToolSlug } from "../tool-catalog/index.ts";
import { requireTransactionPermission } from "../admin/adminMutations.ts";
import { BlogValidationError, validateBlogDocument, validateBlogImage } from "./document.ts";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const search = z
  .string()
  .trim()
  .max(200)
  .refine((value) => value.isWellFormed() && !value.includes("\u0000"), "Search contains invalid text.")
  .optional();
const cursorInput = z.string().max(1200).optional();
const publicInput = z.object({ search, category: slug.optional(), tag: slug.optional(), cursor: cursorInput }).strict();
const pageInput = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const adminPostInput = z
  .object({
    search,
    status: z.enum(["draft", "published", "scheduled", "trash"]).optional(),
    categoryId: id.optional(),
    page: pageInput,
    cursor: cursorInput,
  })
  .strict();
const termInput = z.object({ search, cursor: cursorInput }).strict();
const adminTermInput = termInput.extend({ page: pageInput });
const termKind = z.enum(["category", "tag"]);
const dateCursor = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() > 0 &&
      date.toISOString().slice(0, 23) === value.slice(0, 23)
    );
  });
const cursorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["published", "admin", "trash"]), value: dateCursor, id }).strict(),
  z
    .object({
      kind: z.enum(["category", "tag"]),
      value: z
        .string()
        .min(1)
        .max(100)
        .refine((value) => value.isWellFormed() && !value.includes("\u0000")),
      id,
    })
    .strict(),
  z.object({ kind: z.literal("history"), value: z.number().int().positive(), id }).strict(),
]);
type BlogCursor = z.infer<typeof cursorSchema>;

export function encodeBlogCursor(cursor: BlogCursor): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString("base64url");
}

export function decodeBlogCursor(value: string | undefined, kind: BlogCursor["kind"]): BlogCursor | null {
  if (value === undefined) return null;
  if (!value || value.length > 1200 || !/^[a-zA-Z0-9_-]+$/.test(value))
    throw new BlogValidationError("Invalid blog pagination cursor.");
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.kind !== kind) throw new Error("Wrong cursor kind.");
    return cursor;
  } catch {
    throw new BlogValidationError("Invalid blog pagination cursor.");
  }
}

export function paginateBlogRows<T>(rows: T[], size: number, cursor: (row: T) => BlogCursor) {
  const items = rows.slice(0, size);
  return {
    items,
    nextCursor: rows.length > size ? encodeBlogCursor(cursor(items[items.length - 1])) : null,
  };
}

const live = and(isNotNull(posts.publishedRevisionId), isNull(posts.trashedAt));
// Preserve PostgreSQL microseconds in cursors; Date's millisecond precision skips ties.
const cursorTime = (column: SQL | typeof posts.firstPublishedAt | typeof posts.updatedAt | typeof posts.trashedAt) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const dateAfter = (
  column: typeof posts.firstPublishedAt | typeof posts.updatedAt | typeof posts.trashedAt,
  cursor: BlogCursor | null,
) => (cursor ? sql`(${column}, ${posts.id}) < (${cursor.value}::timestamptz, ${cursor.id})` : undefined);
const likeSearch = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
const cloudOptions = () => ({ cloudName: config.cloudinary.cloudName?.trim() });

const summaryFields = {
  id: posts.id,
  slug: posts.slug,
  title: sql<unknown>`${revisions.document}->>'title'`,
  excerpt: sql<unknown>`${revisions.document}->>'excerpt'`,
  authorName: sql<unknown>`${revisions.document}->>'authorName'`,
  coverImage: sql<unknown>`${revisions.document}->'coverImage'`,
  category: { id: categories.id, label: categories.name, slug: categories.slug },
  firstPublishedAt: posts.firstPublishedAt,
  publishedUpdatedAt: posts.publishedUpdatedAt,
};

const titleText = z.string().max(200);
const excerptText = z.string().max(500);
const authorText = z.string().max(150);
const taxonomyCreator = alias(authUser, "taxonomy_creator");
const taxonomyEditor = alias(authUser, "taxonomy_editor");

export async function listPublishedBlogPosts(input: unknown = {}) {
  const options = publicInput.parse(input);
  const cursor = decodeBlogCursor(options.cursor, "published");
  const rows = await db
    .select({ ...summaryFields, cursorTime: cursorTime(posts.firstPublishedAt) })
    .from(posts)
    .innerJoin(revisions, and(eq(revisions.id, posts.publishedRevisionId), eq(revisions.postId, posts.id)))
    .innerJoin(categories, eq(categories.id, posts.publishedCategoryId))
    .where(
      and(
        live,
        dateAfter(posts.firstPublishedAt, cursor),
        options.search
          ? sql`${posts.publishedSearch} @@ websearch_to_tsquery('english', ${options.search})`
          : undefined,
        options.category ? eq(categories.slug, options.category) : undefined,
        options.tag
          ? exists(
              db
                .select({ id: postTags.postId })
                .from(postTags)
                .innerJoin(tags, eq(tags.id, postTags.tagId))
                .where(and(eq(postTags.postId, posts.id), eq(tags.slug, options.tag))),
            )
          : undefined,
      ),
    )
    .orderBy(desc(posts.firstPublishedAt), desc(posts.id))
    .limit(13);
  const page = paginateBlogRows(rows, 12, (row) => ({
    kind: "published",
    value: row.cursorTime,
    id: row.id,
  }));
  return {
    ...page,
    items: page.items.map(({ cursorTime: _cursor, ...row }) => ({
      ...row,
      title: titleText.parse(row.title),
      excerpt: excerptText.parse(row.excerpt),
      authorName: authorText.parse(row.authorName),
      coverImage: row.coverImage === null ? null : validateBlogImage(row.coverImage, cloudOptions()),
    })),
  };
}

export async function getBlogSitemapEntries(limit: number) {
  const size = z.number().int().min(0).max(50000).parse(limit);
  if (size === 0) return [];
  return db
    .select({ slug: posts.slug, publishedUpdatedAt: posts.publishedUpdatedAt })
    .from(posts)
    .where(live)
    .orderBy(desc(posts.firstPublishedAt), desc(posts.id))
    .limit(size);
}

const currentTerms = sql<unknown>`COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', bt.id, 'label', bt.name, 'slug', bt.slug) ORDER BY bt.name, bt.id)
  FROM blog_published_post_tags bpt JOIN blog_tags bt ON bt.id = bpt.tag_id
  WHERE bpt.post_id = ${posts.id}
), '[]'::jsonb)`;
const publicTerms = z.array(z.object({ id, label: z.string().min(1).max(100), slug }).strict()).max(20);

export async function getPublishedBlogPost(postSlug: string) {
  const requestedSlug = slug.parse(postSlug);
  const [row] = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      document: revisions.document,
      category: { id: categories.id, label: categories.name, slug: categories.slug },
      tags: currentTerms,
      firstPublishedAt: posts.firstPublishedAt,
      publishedUpdatedAt: posts.publishedUpdatedAt,
    })
    .from(posts)
    .innerJoin(revisions, and(eq(revisions.id, posts.publishedRevisionId), eq(revisions.postId, posts.id)))
    .innerJoin(categories, eq(categories.id, posts.publishedCategoryId))
    .where(and(live, eq(posts.slug, requestedSlug)))
    .limit(1);
  if (!row) return null;
  const document = validateBlogDocument(row.document, cloudOptions());
  const selectedTags = publicTerms.parse(row.tags);
  const relatedTools = document.relatedToolIds.length
    ? await db
        .select({
          id: managedToolsTable.toolId,
          name: managedToolsTable.name,
          app: managedToolsTable.app,
          slug: managedToolsTable.slug,
        })
        .from(managedToolsTable)
        .where(
          and(
            inArray(managedToolsTable.toolId, document.relatedToolIds),
            eq(managedToolsTable.enabled, true),
            eq(managedToolsTable.archived, false),
            isNotNull(managedToolsTable.slug),
          ),
        )
    : [];
  const byId = new Map(relatedTools.map((tool) => [tool.id, tool]));
  const relatedToolLinks = document.relatedToolIds.flatMap((toolId) => {
    const tool = byId.get(toolId);
    return tool && isValidToolSlug(tool.app, tool.slug)
      ? [{ id: tool.id, name: tool.name, href: `/${tool.app}/${tool.slug}` }]
      : [];
  });
  return {
    ...row,
    tags: selectedTags,
    relatedToolLinks,
    document: {
      ...document,
      category: { id: row.category.id, label: row.category.label },
      tags: selectedTags.map(({ id, label }) => ({ id, label })),
      relatedToolIds: relatedToolLinks.map((tool) => tool.id),
    },
  };
}

export async function listBlogPosts(actorUserId: string, input: unknown = {}) {
  const options = adminPostInput.parse(input);
  const timeColumn = options.status === "trash" ? posts.trashedAt : posts.updatedAt;
  const kind = options.status === "trash" ? "trash" : "admin";
  const cursor = decodeBlogCursor(options.cursor, kind);
  const aiEnabled = (await loadRuntimeSettings())["ai.enabled"].value === true;
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "blog", "view");
    const filters = and(
      options.status === "trash" ? isNotNull(posts.trashedAt) : isNull(posts.trashedAt),
      options.status === "published" ? isNotNull(posts.publishedRevisionId) : undefined,
      options.status === "scheduled" ? isNotNull(schedules.id) : undefined,
      options.status === "draft" ? and(isNull(posts.publishedRevisionId), isNull(schedules.id)) : undefined,
      options.search ? sql`${posts.draftDocument}->>'title' ILIKE ${likeSearch(options.search)}` : undefined,
      options.categoryId ? sql`${posts.draftDocument}->'category'->>'id' = ${options.categoryId}` : undefined,
    );
    const [{ total }] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(posts)
      .leftJoin(schedules, eq(schedules.postId, posts.id))
      .where(filters);
    const pageCount = Math.max(1, Math.ceil(total / 25));
    const pageNumber = Math.min(options.page ?? 1, pageCount);
    const rows = await transaction
      .select({
        id: posts.id,
        slug: posts.slug,
        version: posts.version,
        title: sql<string>`${posts.draftDocument}->>'title'`,
        generationStatus: aiEnabled
          ? sql<string | null>`(SELECT ${runs.status} FROM ${runs}
          WHERE ${runs.integrationKey} = 'blog' AND ${runs.resourceId} = ${posts.id} AND ${runs.operation} = 'generate'
          ORDER BY ${runs.createdAt} DESC LIMIT 1)`
          : sql<null>`NULL`,
        updatedAt: posts.updatedAt,
        trashedAt: posts.trashedAt,
        firstPublishedAt: posts.firstPublishedAt,
        publishedUpdatedAt: posts.publishedUpdatedAt,
        publishedRevisionId: posts.publishedRevisionId,
        hasUnpublishedChanges: sql<boolean>`${posts.publishedRevisionId} IS NOT NULL AND ${posts.draftHash} <> ${revisions.contentHash}`,
        schedule: {
          id: schedules.id,
          revisionId: schedules.revisionId,
          scheduledAt: schedules.scheduledAt,
          lastAttemptAt: schedules.lastAttemptAt,
          lastErrorCode: schedules.lastErrorCode,
        },
        cursorTime: cursorTime(timeColumn),
      })
      .from(posts)
      .leftJoin(schedules, eq(schedules.postId, posts.id))
      .leftJoin(revisions, eq(revisions.id, posts.publishedRevisionId))
      .where(and(filters, options.page === undefined ? dateAfter(timeColumn, cursor) : undefined))
      .orderBy(desc(timeColumn), desc(posts.id))
      .limit(26)
      .offset(options.page === undefined ? 0 : (pageNumber - 1) * 25);
    const page = paginateBlogRows(rows, 25, (row) => ({ kind, value: row.cursorTime, id: row.id }));
    return {
      ...page,
      total,
      page: pageNumber,
      pageCount,
      items: page.items.map(({ cursorTime: _cursor, ...row }) => row),
    };
  });
}

export async function getBlogPost(actorUserId: string, postId: string) {
  const requestedId = id.parse(postId);
  return db.transaction(
    async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "blog", "view");
      const [post] = await transaction.select().from(posts).where(eq(posts.id, requestedId)).limit(1);
      if (!post) return null;
      const [schedule] = await transaction.select().from(schedules).where(eq(schedules.postId, requestedId)).limit(1);
      return {
        ...post,
        draftDocument: validateBlogDocument(post.draftDocument, cloudOptions()),
        schedule: schedule ?? null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function getBlogRevision(actorUserId: string, postId: string, revisionId: string) {
  const requestedId = id.parse(postId);
  const requestedRevision = id.parse(revisionId);
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "blog", "view");
    const [revision] = await transaction
      .select()
      .from(revisions)
      .where(and(eq(revisions.postId, requestedId), eq(revisions.id, requestedRevision)))
      .limit(1);
    return revision ? { ...revision, document: validateBlogDocument(revision.document, cloudOptions()) } : null;
  });
}

export async function listBlogRevisions(actorUserId: string, postId: string, before?: string, requestedPage?: number) {
  const selectedPage = pageInput.parse(requestedPage);
  const requestedId = id.parse(postId);
  const cursor = decodeBlogCursor(before, "history");
  if (cursor && cursor.id !== requestedId) throw new BlogValidationError("Revision cursor belongs to another post.");
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "blog", "view");
    const [{ total }] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(revisions)
      .where(eq(revisions.postId, requestedId));
    const pageCount = Math.max(1, Math.ceil(total / 25));
    const pageNumber = Math.min(selectedPage ?? 1, pageCount);
    const rows = await transaction
      .select({
        id: revisions.id,
        postId: revisions.postId,
        revisionNumber: revisions.revisionNumber,
        reason: revisions.reason,
        sourceRevisionId: revisions.sourceRevisionId,
        createdBy: revisions.createdBy,
        createdAt: revisions.createdAt,
        title: sql<string>`${revisions.document}->>'title'`,
      })
      .from(revisions)
      .where(
        and(
          eq(revisions.postId, requestedId),
          selectedPage === undefined && cursor ? sql`${revisions.revisionNumber} < ${cursor.value}` : undefined,
        ),
      )
      .orderBy(desc(revisions.revisionNumber))
      .limit(26)
      .offset(selectedPage === undefined ? 0 : (pageNumber - 1) * 25);
    const result = paginateBlogRows(rows, 25, (row) => ({
      kind: "history",
      value: row.revisionNumber,
      id: requestedId,
    }));
    return { ...result, total, page: pageNumber, pageCount };
  });
}

export async function listBlogTaxonomy(actorUserId: string, kind: "category" | "tag", input: unknown = {}) {
  const selectedKind = termKind.parse(kind);
  const options = adminTermInput.parse(input);
  const cursor = decodeBlogCursor(options.cursor, selectedKind);
  const table = selectedKind === "category" ? categories : tags;
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "blog", "view");
    const filters = options.search ? sql`${table.name} ILIKE ${likeSearch(options.search)}` : undefined;
    const [{ total }] = await transaction
      .select({ total: sql<number>`count(*)::int` })
      .from(table)
      .where(filters);
    const pageCount = Math.max(1, Math.ceil(total / 25));
    const pageNumber = Math.min(options.page ?? 1, pageCount);
    const rows = await transaction
      .select({
        id: table.id,
        name: table.name,
        slug: table.slug,
        createdBy: table.createdBy,
        updatedBy: table.updatedBy,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
        createdByUser: { name: taxonomyCreator.name, image: taxonomyCreator.image },
        updatedByUser: { name: taxonomyEditor.name, image: taxonomyEditor.image },
      })
      .from(table)
      .leftJoin(taxonomyCreator, eq(taxonomyCreator.id, table.createdBy))
      .leftJoin(taxonomyEditor, eq(taxonomyEditor.id, table.updatedBy))
      .where(
        and(
          filters,
          options.page === undefined && cursor
            ? sql`(${table.name}, ${table.id}) > (${cursor.value}, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(table.name, table.id)
      .limit(26)
      .offset(options.page === undefined ? 0 : (pageNumber - 1) * 25);
    const result = paginateBlogRows(rows, 25, (row) => ({
      kind: selectedKind,
      value: row.name,
      id: row.id,
    }));
    return { ...result, total, page: pageNumber, pageCount };
  });
}

export async function listPublishedBlogTaxonomy(kind: "category" | "tag", input: unknown = {}) {
  const selectedKind = termKind.parse(kind);
  const options = termInput.parse(input);
  const cursor = decodeBlogCursor(options.cursor, selectedKind);
  const table = selectedKind === "category" ? categories : tags;
  const used =
    selectedKind === "category"
      ? exists(
          db
            .select({ id: posts.id })
            .from(posts)
            .where(and(live, eq(posts.publishedCategoryId, table.id))),
        )
      : exists(
          db
            .select({ id: posts.id })
            .from(posts)
            .innerJoin(postTags, eq(postTags.postId, posts.id))
            .where(and(live, eq(postTags.tagId, table.id))),
        );
  const rows = await db
    .select({ id: table.id, name: table.name, slug: table.slug })
    .from(table)
    .where(
      and(
        used,
        options.search ? sql`${table.name} ILIKE ${likeSearch(options.search)}` : undefined,
        cursor ? sql`(${table.name}, ${table.id}) > (${cursor.value}, ${cursor.id})` : undefined,
      ),
    )
    .orderBy(table.name, table.id)
    .limit(26);
  return paginateBlogRows(rows, 25, (row) => ({ kind: selectedKind, value: row.name, id: row.id }));
}
