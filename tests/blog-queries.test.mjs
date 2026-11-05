import { test, expect, vi, onTestFinished } from "vitest";

vi.mock("server-only", () => ({}));
import { db } from "../db/index.ts";
import { BlogValidationError } from "../lib/blog/document.ts";
import {
  decodeBlogCursor,
  encodeBlogCursor,
  paginateBlogRows,
  getBlogPost,
  getBlogRevision,
  getPublishedBlogPost,
  listBlogPosts,
  listBlogRevisions,
  listBlogTaxonomy,
  listPublishedBlogPosts,
  listPublishedBlogTaxonomy,
} from "../lib/blog/queries.ts";

test("admin queries accept numbered pages before entering the database transaction", async (t) => {
  const reachedDatabase = new Error("Database boundary reached");
  const originalTransaction = db.transaction;
  const transaction = vi.fn(async () => {
    throw reachedDatabase;
  });
  db.transaction = transaction;
  onTestFinished(() => {
    db.transaction = originalTransaction;
  });
  for (const page of [1, 2, 100]) {
    await expect(listBlogPosts("admin", { page })).rejects.toSatisfy((error) => error === reachedDatabase);
    await expect(listBlogTaxonomy("admin", "category", { page })).rejects.toSatisfy(
      (error) => error === reachedDatabase,
    );
    await expect(listBlogRevisions("admin", "post", undefined, page)).rejects.toSatisfy(
      (error) => error === reachedDatabase,
    );
  }
  expect(transaction.mock.calls.length).toBe(9);
  for (const page of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
    await expect(listBlogPosts("admin", { page })).rejects.toMatchObject({ name: "ZodError" });
  }
  expect(transaction.mock.calls.length).toBe(9);
});

test("blog date cursors retain database microseconds and reject invalid or mismatched cursors", () => {
  const cursor = { kind: "published", value: "2026-09-16T10:00:00.123456Z", id: "post-1" };
  expect(decodeBlogCursor(encodeBlogCursor(cursor), "published")).toEqual(cursor);
  expect(decodeBlogCursor(undefined, "published")).toBe(null);
  expect(() => decodeBlogCursor(encodeBlogCursor(cursor), "admin")).toThrow(BlogValidationError);
  for (const input of ["", "!bad", "a".repeat(1201), Buffer.from("not json").toString("base64url")]) {
    expect(() => decodeBlogCursor(input, "published")).toThrow(/cursor/);
  }
  for (const value of [
    "2026-02-30T10:00:00.123456Z",
    "2026-09-16T10:00:00.123Z",
    "invalid",
    "0000-01-01T00:00:00.000000Z",
  ]) {
    expect(() => encodeBlogCursor({ ...cursor, value })).toThrow();
  }
  expect(() => encodeBlogCursor({ ...cursor, id: "' OR true; --" })).toThrow();
  expect(() =>
    decodeBlogCursor(Buffer.from(JSON.stringify({ ...cursor, extra: true })).toString("base64url"), "published"),
  ).toThrow(/cursor/);
});

test("keyset pagination emits a next cursor only when a further row exists", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({
    id: `post-${index}`,
    time: "2026-09-16T10:00:00.000001Z",
  }));
  const cursor = (row) => ({ kind: "published", value: row.time, id: row.id });
  expect(paginateBlogRows([], 12, cursor)).toEqual({ items: [], nextCursor: null });
  expect(paginateBlogRows(rows.slice(0, 12), 12, cursor).nextCursor).toBe(null);
  const page = paginateBlogRows(rows, 12, cursor);
  expect(page.items.length).toBe(12);
  expect(decodeBlogCursor(page.nextCursor, "published").id).toBe("post-11");
  expect(rows.length).toBe(13);
});

test("taxonomy and revision cursors retain their own ordering and scope", () => {
  for (const kind of ["category", "tag"]) {
    const cursor = { kind, value: "Résumé & Guides", id: "term-1" };
    expect(decodeBlogCursor(encodeBlogCursor(cursor), kind)).toEqual(cursor);
  }
  const revision = { kind: "history", value: 12, id: "post-1" };
  expect(decodeBlogCursor(encodeBlogCursor(revision), "history")).toEqual(revision);
  expect(() => encodeBlogCursor({ ...revision, value: 0 })).toThrow();
  expect(() => encodeBlogCursor({ ...revision, value: 2.5 })).toThrow();
  expect(() => encodeBlogCursor({ kind: "category", value: "invalid\u0000name", id: "term-1" })).toThrow();
  expect(() => encodeBlogCursor({ kind: "tag", value: "\ud800", id: "term-1" })).toThrow();
});

test("query boundaries reject malformed filters and IDs before opening a database connection", async () => {
  const operations = [
    () => listPublishedBlogPosts({ search: "x".repeat(201) }),
    () => listPublishedBlogPosts({ search: "invalid\u0000query" }),
    () => listBlogPosts("admin", { search: "\ud800" }),
    () => listBlogTaxonomy("admin", "category", { search: "\u0000" }),
    () => listPublishedBlogPosts({ category: "unsafe/category" }),
    () => listPublishedBlogPosts({ cursor: "bad-cursor" }),
    () => listPublishedBlogPosts({ limit: 100000 }),
    () => getPublishedBlogPost("../draft"),
    () => listBlogPosts("admin", { status: "everything" }),
    () => listBlogPosts("admin", { categoryId: "invalid id" }),
    () => getBlogPost("admin", ""),
    () => getBlogRevision("admin", "post", "../revision"),
    () => listBlogRevisions("admin", "post", encodeBlogCursor({ kind: "history", value: 1, id: "other-post" })),
    () => listBlogTaxonomy("admin", "author"),
    () => listPublishedBlogTaxonomy("category", { createdBy: "admin" }),
  ];
  for (const operation of operations) await expect(operation()).rejects.toThrow();
});
