import { test, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
import { PgDialect } from "drizzle-orm/pg-core";
import { ADMIN_ACCESS } from "../lib/authorization/index.ts";
import {
  db,
  auditEventsTable,
  blogPostsTable as posts,
  blogRevisionsTable as revisions,
  blogPostSchedulesTable as schedules,
  blogCategoriesTable as categories,
  blogTagsTable as tags,
  blogPublishedPostTagsTable as publishedTags,
} from "../db/index.ts";
import {
  createBlogPost,
  duplicateBlogPost,
  saveBlogDraft,
  publishBlogPost,
  scheduleBlogPost,
  retryBlogSchedule,
  cancelBlogSchedule,
  unpublishBlogPost,
  trashBlogPost,
  restoreTrashedBlogPost,
  restoreBlogRevision,
  saveBlogTerm,
  publishDueBlogPosts,
} from "../lib/blog/mutations.ts";
import { blogDocumentHash, createBlogDocument, validateBlogDocument } from "../lib/blog/document.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date("2026-09-16T10:30:00Z");
const category = { id: "category-1", name: "Guides", slug: "guides" };
const tag = { id: "tag-1", name: "PDF", slug: "pdf" };
const clock = () => ({ rows: [{ now: NOW }] });
const dialect = new PgDialect();
const query = (condition) => (condition ? dialect.sqlToQuery(condition) : { sql: "", params: [] });
function document(title = "Original article") {
  return validateBlogDocument({
    ...createBlogDocument(title),
    excerpt: "A useful article.",
    body: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Useful content." }] }],
    },
    category: { id: category.id, label: category.name },
    tags: [{ id: tag.id, label: tag.name }],
  });
}
function post(overrides = {}) {
  const draft = document();
  return {
    id: "post-1",
    slug: "original-article",
    draftDocument: draft,
    draftHash: blogDocumentHash(draft),
    version: 5,
    revisionSequence: 2,
    lastCheckpointAt: new Date(NOW.getTime() - 120_000),
    draftUpdatedAt: new Date(NOW.getTime() - 120_000),
    draftUpdatedBy: "actor",
    publishedRevisionId: "revision-live",
    publishedCategoryId: category.id,
    firstPublishedAt: new Date("2026-09-01T10:00:00Z"),
    publishedUpdatedAt: new Date("2026-09-01T10:00:00Z"),
    createdBy: "actor",
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: NOW,
    trashedAt: null,
    ...overrides,
  };
}
function revision(row, overrides = {}) {
  return {
    id: "revision-2",
    postId: row.id,
    revisionNumber: row.revisionSequence,
    document: row.draftDocument,
    contentHash: row.draftHash,
    reason: "manual_save",
    createdBy: "actor",
    createdAt: row.lastCheckpointAt,
    sourceRevisionId: null,
    ...overrides,
  };
}
function permission({ missing, status = "active" } = {}) {
  const access = structuredClone(ADMIN_ACCESS);
  if (missing) delete access.blog[missing];
  return [
    {
      status,
      roleId: "blog-manager",
      roleName: "Blog manager",
      roleDescription: "Custom blog role",
      roleAccess: access,
      roleIsSystem: false,
    },
  ];
}

// Scripted database boundary: real mutation/validation/permission code runs.
// Transactions stage writes and roll back on exceptions. SQL locking and actual
// uniqueness remain covered by the separate PostgreSQL integration suite.
async function withDatabase(reads, callback, options = {}) {
  const original = {
    transaction: db.transaction,
    select: db.select,
    update: db.update,
    execute: db.execute,
  };
  const queue = [...reads];
  const state = {
    committed: [],
    rolledBack: [],
    post: structuredClone(options.post ?? post()),
    readQueries: [],
    attempts: 0,
  };
  let staged;
  let conflicts = options.insertConflicts ?? 0;
  const select = () => {
    const entry = {};
    const chain = {
      from(table) {
        entry.table = table;
        return chain;
      },
      where(condition) {
        entry.condition = query(condition);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => chain,
      for: () => chain,
      orderBy: () => chain,
      then(resolve, reject) {
        state.readQueries.push(entry);
        const next = queue.shift();
        return Promise.resolve()
          .then(() => {
            if (next === undefined) throw new Error("Unexpected database read");
            if (next instanceof Error) throw next;
            return typeof next === "function" ? next(state) : structuredClone(next);
          })
          .then(resolve, reject);
      },
    };
    return chain;
  };
  const mutation = (kind, table) => {
    const entry = { kind, table, values: undefined, condition: undefined };
    let completed;
    const perform = () => {
      if (completed) return completed;
      if (options.failWrite?.(entry)) throw new Error("simulated database write failure");
      if (kind === "insert" && table === posts && conflicts-- > 0) return [];
      const values = entry.values;
      let rows = [];
      if (kind === "insert") {
        rows = Array.isArray(values) ? values : [values];
        if (table === posts)
          rows = rows.map((value) => ({
            ...post({
              version: 1,
              revisionSequence: 0,
              lastCheckpointAt: null,
              publishedRevisionId: null,
              publishedCategoryId: null,
              firstPublishedAt: null,
              publishedUpdatedAt: null,
            }),
            ...value,
          }));
      } else if (kind === "update") {
        rows = [{ ...(table === posts ? state.post : (options.term ?? {})), ...values }];
      } else if (table === schedules) rows = structuredClone(options.removedSchedules ?? []);
      if (table === posts && rows[0]) state.post = { ...rows[0] };
      (staged ?? state.committed).push(entry);
      completed = rows;
      return rows;
    };
    const chain = {
      values(values) {
        entry.values = values;
        return chain;
      },
      set(values) {
        entry.values = values;
        return chain;
      },
      where(condition) {
        entry.condition = query(condition);
        return chain;
      },
      onConflictDoNothing: () => chain,
      returning: () => Promise.resolve().then(perform),
      then: (resolve, reject) => Promise.resolve().then(perform).then(resolve, reject),
    };
    return chain;
  };
  const execute = async (statement) => {
    const compiled = query(statement);
    if (/^SET LOCAL /i.test(compiled.sql)) return [];
    const next = queue.shift();
    if (next === undefined) throw new Error("Unexpected database statement");
    if (next instanceof Error) throw next;
    return structuredClone(next);
  };
  const tx = {
    select,
    insert: (table) => mutation("insert", table),
    update: (table) => mutation("update", table),
    delete: (table) => mutation("delete", table),
    execute,
  };
  db.select = select;
  db.update = tx.update;
  db.execute = execute;
  db.transaction = async (operation) => {
    state.attempts++;
    const before = structuredClone(state.post);
    staged = [];
    try {
      const result = await operation(tx);
      state.committed.push(...staged);
      return result;
    } catch (error) {
      state.rolledBack.push(...staged);
      state.post = before;
      throw error;
    } finally {
      staged = undefined;
    }
  };
  try {
    await callback(state);
    expect(queue.length, "all expected database reads were exercised").toBe(0);
  } finally {
    Object.assign(db, original);
  }
}
const writes = (state, table, kind) =>
  state.committed.filter((entry) => entry.table === table && (!kind || entry.kind === kind));
const auditActions = (state) => writes(state, auditEventsTable).map((entry) => entry.values.action);

test("every administrative blog mutation rejects missing permission before content writes", async () => {
  const input = { postId: "post-1", version: 5 };
  const cases = [
    ["create", () => createBlogPost("actor", { title: "Test" })],
    ["create", () => duplicateBlogPost("actor", { postId: input.postId })],
    ["edit", () => saveBlogDraft("actor", { ...input, document: document() })],
    ["publish", () => publishBlogPost("actor", input)],
    ["publish", () => scheduleBlogPost("actor", { ...input, scheduledAt: "2026-09-17T00:00:00Z" })],
    ["publish", () => retryBlogSchedule("actor", input)],
    ["publish", () => cancelBlogSchedule("actor", input)],
    ["publish", () => unpublishBlogPost("actor", input)],
    ["archive", () => trashBlogPost("actor", input)],
    ["archive", () => restoreTrashedBlogPost("actor", input)],
    ["edit", () => restoreBlogRevision("actor", { ...input, revisionId: "revision-1" })],
    ["edit", () => saveBlogTerm("actor", { kind: "category", name: "Guides" })],
  ];
  for (const [missing, invoke] of cases)
    await withDatabase([permission({ missing })], async (state) => {
      await expect(invoke()).rejects.toThrow(new RegExp(`Missing permission: blog.${missing}`));
      expect(state.committed).toEqual([]);
    });
});

test("stale versions, trash, and absent articles reject saves without overwriting work", async () => {
  for (const [rows, code] of [
    [[post({ version: 6 })], "CONFLICT"],
    [[post({ trashedAt: NOW })], "VALIDATION"],
    [[], "NOT_FOUND"],
  ]) {
    await withDatabase([permission(), rows], async (state) => {
      await expect(
        saveBlogDraft("actor", { postId: "post-1", version: 5, document: document() }),
      ).rejects.toMatchObject({
        code,
      });
      expect(state.committed).toEqual([]);
    });
  }
});

test("title limit is enforced when creating and saving drafts before content writes", async () => {
  const title = Array(20).fill("word").join(" ");
  await withDatabase([permission(), clock(), []], async () => {
    const result = await createBlogPost("actor", { title });
    expect(result.draftDocument.title).toBe(title);
  });
  await withDatabase([permission()], async (state) => {
    await expect(createBlogPost("actor", { title: `${title} extra` })).rejects.toThrow(/20 words/);
    expect(state.committed.length).toBe(0);
  });
  const current = post({ lastCheckpointAt: new Date(NOW.getTime() - 1000) });
  await withDatabase([permission(), [current], [category], [tag], clock()], async () => {
    const result = await saveBlogDraft("actor", {
      postId: current.id,
      version: current.version,
      document: { ...current.draftDocument, title },
    });
    expect(result.draftDocument.title).toBe(title);
  });
  await withDatabase([permission(), [current]], async (state) => {
    await expect(
      saveBlogDraft("actor", {
        postId: current.id,
        version: current.version,
        document: { ...current.draftDocument, title: `${title} extra` },
      }),
    ).rejects.toThrow(/20 words/);
    expect(state.committed.length).toBe(0);
  });
});

test("autosave canonicalizes taxonomy, checkpoints changed work, and leaves public state and slug intact", async () => {
  const current = post();
  const changed = document("Updated title");
  changed.category.label = "Untrusted client label";
  changed.tags[0].label = "Untrusted tag label";
  await withDatabase(
    [permission(), [current], [category], [tag], clock(), [revision(current)]],
    async (state) => {
      const result = await saveBlogDraft("actor", {
        postId: current.id,
        version: current.version,
        document: changed,
      });
      expect(result.version).toBe(6);
      expect(result.slug).toBe(current.slug);
      expect(result.publishedRevisionId).toBe(current.publishedRevisionId);
      expect(result.publishedUpdatedAt).toEqual(current.publishedUpdatedAt);
      expect(result.draftDocument.category.label).toBe(category.name);
      expect(result.draftDocument.tags[0].label).toBe(tag.name);
      const [snapshot] = writes(state, revisions);
      expect(snapshot.values.reason).toBe("autosave");
      expect(snapshot.values.revisionNumber).toBe(3);
      expect(snapshot.values.document.title).toBe("Updated title");
      expect(auditActions(state)).toEqual(["blog.save"]);
      expect(writes(state, schedules).length).toBe(0);
      expect(writes(state, publishedTags).length).toBe(0);
    },
    { post: current },
  );
});

test("autosaves persist before checkpoint interval and unchanged saves do not churn versions", async () => {
  const current = post({ lastCheckpointAt: new Date(NOW.getTime() - 1000) });
  for (const changed of [true, false])
    await withDatabase(
      [permission(), [current], [category], [tag], clock()],
      async (state) => {
        const result = await saveBlogDraft("actor", {
          postId: current.id,
          version: current.version,
          document: changed ? document("Latest edit") : current.draftDocument,
        });
        expect(result.version).toBe(changed ? 6 : 5);
        expect(writes(state, revisions).length).toBe(0);
        expect(writes(state, posts).length).toBe(changed ? 1 : 0);
      },
      { post: current },
    );
});

test("manual save captures uncheckpointed work and reuses an identical latest revision", async () => {
  const current = post({ lastCheckpointAt: new Date(NOW.getTime() - 1000) });
  for (const sameRevision of [true, false])
    await withDatabase(
      [
        permission(),
        [current],
        [category],
        [tag],
        clock(),
        [revision(current, sameRevision ? {} : { contentHash: "older-content" })],
      ],
      async (state) => {
        const result = await saveBlogDraft("actor", {
          postId: current.id,
          version: current.version,
          document: current.draftDocument,
          mode: "manual",
        });
        expect(result.version).toBe(5);
        expect(writes(state, revisions).length).toBe(sameRevision ? 0 : 1);
        if (!sameRevision) expect(writes(state, revisions)[0].values.reason).toBe("manual_save");
      },
      { post: current },
    );
});

test("revision restoration backs up unsaved-to-history content and changes only the working draft", async () => {
  const current = post();
  const historical = document("Historical title");
  historical.category.label = "Historical category name";
  const source = revision(current, {
    id: "revision-1",
    revisionNumber: 1,
    document: historical,
    contentHash: blogDocumentHash(historical),
  });
  await withDatabase(
    [
      permission(),
      [current],
      [source],
      [category],
      [tag],
      clock(),
      [revision(current, { contentHash: "prior-checkpoint" })],
      [],
    ],
    async (state) => {
      const result = await restoreBlogRevision("actor", {
        postId: current.id,
        version: current.version,
        revisionId: source.id,
      });
      expect(result.draftDocument.title).toBe(historical.title);
      expect(result.draftDocument.category.label).toBe("Historical category name");
      expect(result.slug).toBe(current.slug);
      expect(result.publishedRevisionId).toBe(current.publishedRevisionId);
      expect(result.version).toBe(6);
      const snapshots = writes(state, revisions).map((entry) => entry.values);
      expect(snapshots.map((row) => row.reason)).toEqual(["restore_backup", "restore"]);
      expect(snapshots.map((row) => row.revisionNumber)).toEqual([3, 4]);
      expect(snapshots[0].document.title).toBe(current.draftDocument.title);
      expect(snapshots[1].sourceRevisionId).toBe(source.id);
      expect(writes(state, schedules).length).toBe(0);
      expect(writes(state, publishedTags).length).toBe(0);
    },
    { post: current },
  );
});

test("create retries unique slug conflicts with a random suffix and records an initial revision", async () => {
  await withDatabase(
    [permission(), clock(), []],
    async (state) => {
      const result = await createBlogPost("actor", { title: "How & Why" });
      expect(result.slug).toMatch(/^how-and-why-[0-9a-f]{8}$/);
      expect(result.revisionSequence).toBe(1);
      expect(result.publishedRevisionId).toBe(null);
      expect(writes(state, revisions)[0].values.reason).toBe("create");
      expect(auditActions(state)).toEqual(["blog.create"]);
    },
    { insertConflicts: 1 },
  );
  await withDatabase(
    [permission()],
    async (state) => {
      await expect(createBlogPost("actor", { title: "Collisions" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(state.committed.length).toBe(0);
    },
    { insertConflicts: 5 },
  );
});

test("duplicating starts a new draft with its own identity and initial history", async () => {
  const source = post();
  await withDatabase([permission(), permission(), [source], [category], [tag], clock(), []], async (state) => {
    const result = await duplicateBlogPost("actor", { postId: source.id });
    expect(result.id).not.toBe(source.id);
    expect(result.draftDocument).toEqual(source.draftDocument);
    expect(result.publishedRevisionId).toBe(null);
    expect(result.firstPublishedAt).toBe(null);
    expect(result.version).toBe(1);
    expect(result.revisionSequence).toBe(1);
    expect(writes(state, revisions).length).toBe(1);
    expect(writes(state, schedules).length).toBe(0);
    expect(auditActions(state)).toEqual(["blog.duplicate"]);
  });
});

test("unknown taxonomy references and incomplete article content fail before snapshot or publication writes", async () => {
  const current = post();
  await withDatabase([permission(), [current], []], async (state) => {
    await expect(
      saveBlogDraft("actor", {
        postId: current.id,
        version: current.version,
        document: current.draftDocument,
      }),
    ).rejects.toThrow(/existing category/);
    expect(state.committed.length).toBe(0);
  });
  const incomplete = post({ draftDocument: { ...document(), excerpt: "" } });
  await withDatabase([permission(), [incomplete], [category], [tag]], async (state) => {
    await expect(publishBlogPost("actor", { postId: current.id, version: current.version })).rejects.toThrow(
      /Excerpt is required/,
    );
    expect(state.committed.length).toBe(0);
  });
});

test("publishing promotes a snapshot and clears schedule, with audit failure rolling everything back", async () => {
  const current = post();
  const snapshot = revision(current);
  const reads = () => [permission(), [current], [category], [tag], clock(), [snapshot], [category], [tag]];
  for (const failAudit of [false, true])
    await withDatabase(
      reads(),
      async (state) => {
        const invoke = () => publishBlogPost("actor", { postId: current.id, version: current.version });
        if (failAudit) {
          await expect(invoke()).rejects.toThrow(/simulated database write failure/);
          expect(state.committed.length).toBe(0);
          expect(state.post.publishedRevisionId).toBe(current.publishedRevisionId);
          expect(state.rolledBack.some((entry) => entry.table === schedules)).toBeTruthy();
          return;
        }
        const result = await invoke();
        expect(result.publishedRevisionId).toBe(snapshot.id);
        expect(result.draftDocument.title).toBe(current.draftDocument.title);
        expect(result.version).toBe(6);
        expect(result.firstPublishedAt).toEqual(current.firstPublishedAt);
        expect(result.publishedUpdatedAt).toEqual(NOW);
        expect(writes(state, schedules, "delete").length).toBe(1);
        expect(writes(state, publishedTags, "insert")[0].values).toEqual([{ postId: current.id, tagId: tag.id }]);
        expect(auditActions(state)).toEqual(["blog.publish"]);
      },
      { post: current, failWrite: (entry) => failAudit && entry.table === auditEventsTable },
    );
});

test("scheduling freezes the saved revision and rejects due or past times", async () => {
  const current = post();
  const snapshot = revision(current);
  await withDatabase(
    [permission(), [current], clock(), [category], [tag], [snapshot]],
    async (state) => {
      const result = await scheduleBlogPost("actor", {
        postId: current.id,
        version: current.version,
        scheduledAt: "2026-09-16T11:12:00Z",
      });
      const schedule = writes(state, schedules, "insert")[0].values;
      expect(schedule.revisionId).toBe(snapshot.id);
      expect(schedule.scheduledBy).toBe("actor");
      expect(schedule.scheduledAt.toISOString()).toBe("2026-09-16T11:12:00.000Z");
      expect(result.version).toBe(6);
      expect(result.publishedRevisionId).toBe(current.publishedRevisionId);
      expect(auditActions(state)).toEqual(["blog.schedule"]);
    },
    { post: current },
  );
  await withDatabase([permission(), [current], clock()], async (state) => {
    await expect(
      scheduleBlogPost("actor", {
        postId: current.id,
        version: current.version,
        scheduledAt: NOW.toISOString(),
      }),
    ).rejects.toThrow(/future publication time/);
    expect(state.committed.length).toBe(0);
  });
});

test("live article trash requires publication authority as well as archive permission", async () => {
  await withDatabase(
    [permission({ missing: "publish" }), [post()], permission({ missing: "publish" })],
    async (state) => {
      await expect(trashBlogPost("actor", { postId: "post-1", version: 5 })).rejects.toThrow(
        /Missing permission: blog.publish/,
      );
      expect(state.committed.length).toBe(0);
    },
  );
});

test("unpublishing removes live projections and schedule while trash restoration stays a draft", async () => {
  const current = post();
  await withDatabase(
    [permission(), [current], clock()],
    async (state) => {
      const result = await unpublishBlogPost("actor", {
        postId: current.id,
        version: current.version,
      });
      expect(result.publishedRevisionId).toBe(null);
      expect(result.publishedCategoryId).toBe(null);
      expect(result.publishedSearch).toBe(null);
      expect(writes(state, schedules, "delete").length).toBe(1);
      expect(writes(state, publishedTags, "delete").length).toBe(1);
      expect(result.firstPublishedAt).toEqual(current.firstPublishedAt);
    },
    { post: current },
  );
  const trashed = post({ trashedAt: NOW, publishedRevisionId: null, publishedCategoryId: null });
  await withDatabase(
    [permission(), [trashed], clock()],
    async (state) => {
      const result = await restoreTrashedBlogPost("actor", {
        postId: trashed.id,
        version: trashed.version,
      });
      expect(result.trashedAt).toBe(null);
      expect(result.publishedRevisionId).toBe(null);
      expect(writes(state, schedules).length).toBe(0);
    },
    { post: trashed },
  );
});

test("taxonomy records track creating and editing administrators without changing their slug", async () => {
  for (const kind of ["category", "tag"]) {
    const table = kind === "category" ? categories : tags;
    await withDatabase([permission()], async (state) => {
      const result = await saveBlogTerm("creator", { kind, name: "PDF Guides" });
      expect(result.createdBy).toBe("creator");
      expect(result.updatedBy).toBe("creator");
      expect(result.slug).toBe("pdf-guides");
      expect(writes(state, table).length).toBe(1);
    });
    const existing = { ...category, createdBy: "creator", updatedBy: "creator" };
    await withDatabase(
      [permission(), [existing], [], clock()],
      async (state) => {
        const result = await saveBlogTerm("editor", { kind, id: existing.id, name: "Renamed" });
        expect(result.createdBy).toBe("creator");
        expect(result.updatedBy).toBe("editor");
        expect(result.slug).toBe(existing.slug);
        expect(auditActions(state)).toEqual([`blog.${kind}.edit`]);
      },
      { term: existing },
    );
  }
});

test("taxonomy creation and rename reject names that could corrupt saved article labels", async () => {
  for (const name of ["Bad\u0001name", "Invalid\ud800name"]) {
    for (const id of [undefined, category.id])
      await withDatabase([], async (state) => {
        await expect(saveBlogTerm("editor", { kind: "category", name, ...(id ? { id } : {}) })).rejects.toThrow();
        expect(state.attempts).toBe(0);
        expect(state.committed.length).toBe(0);
      });
  }
});

test("scheduler publishes the frozen revision, preserving newer draft and initial publication date", async () => {
  const current = post({ draftDocument: document("Newer unscheduled draft") });
  current.draftHash = blogDocumentHash(current.draftDocument);
  const frozen = revision(current, {
    id: "frozen",
    document: document("Scheduled content"),
    contentHash: blogDocumentHash(document("Scheduled content")),
  });
  const scheduled = {
    id: "schedule-1",
    postId: current.id,
    revisionId: frozen.id,
    scheduledAt: new Date(NOW.getTime() - 1000),
    scheduledBy: "actor",
  };
  await withDatabase(
    [clock(), [scheduled], permission(), [current], [scheduled], [frozen], clock(), [category], [tag], [{ count: 0 }]],
    async (state) => {
      expect(await publishDueBlogPosts()).toEqual({
        attempted: 1,
        published: 1,
        failed: 0,
        remaining: 0,
      });
      expect(state.post.publishedRevisionId).toBe(frozen.id);
      expect(state.post.draftDocument.title).toBe("Newer unscheduled draft");
      expect(state.post.firstPublishedAt).toEqual(current.firstPublishedAt);
      expect(writes(state, schedules, "delete")[0].condition.params.includes(scheduled.id)).toBe(true);
      expect(auditActions(state)).toEqual(["blog.publish"]);
    },
    { post: current },
  );
});

test("retry-now publishes only the frozen due revision and records the invoking administrator", async () => {
  const current = post({ draftDocument: document("Newer unscheduled draft") });
  current.draftHash = blogDocumentHash(current.draftDocument);
  const frozen = revision(current, {
    id: "frozen",
    document: document("Scheduled version"),
    contentHash: blogDocumentHash(document("Scheduled version")),
  });
  const scheduled = {
    id: "schedule-1",
    postId: current.id,
    revisionId: frozen.id,
    scheduledAt: NOW,
    scheduledBy: "original-publisher",
    lastErrorCode: "TEMPORARY_FAILURE",
  };
  await withDatabase(
    [permission(), [scheduled], permission(), [current], [scheduled], clock(), [frozen], [category], [tag]],
    async (state) => {
      const result = await retryBlogSchedule("retrying-admin", {
        postId: current.id,
        version: current.version,
      });
      expect(result.publishedRevisionId).toBe(frozen.id);
      expect(result.draftDocument.title).toBe("Newer unscheduled draft");
      expect(result.version).toBe(6);
      expect(writes(state, revisions).length).toBe(0);
      expect(writes(state, schedules, "delete")[0].condition.params.includes(scheduled.id)).toBe(true);
      const event = writes(state, auditEventsTable)[0].values;
      expect(event.actorUserId).toBe("retrying-admin");
      expect(event.action).toBe("blog.publish");
      expect(event.metadata.scheduleId).toBe(scheduled.id);
      expect(event.metadata.scheduledAt).toBe(NOW.toISOString());
    },
    { post: current },
  );
});

test("retry-now requires an active original publisher; deleted, suspended and revoked publishers must reschedule", async () => {
  const scheduled = {
    id: "schedule-1",
    postId: "post-1",
    revisionId: "frozen",
    scheduledAt: NOW,
    scheduledBy: "original-publisher",
  };
  for (const originalPermission of [permission({ missing: "publish" }), permission({ status: "suspended" }), []]) {
    await withDatabase([permission(), [scheduled], originalPermission], async (state) => {
      await expect(retryBlogSchedule("retrying-admin", { postId: "post-1", version: 5 })).rejects.toThrow(
        /Access denied|Missing permission/,
      );
      expect(state.committed.length).toBe(0);
    });
  }
  await withDatabase([permission(), [{ ...scheduled, scheduledBy: null }]], async (state) => {
    await expect(retryBlogSchedule("retrying-admin", { postId: "post-1", version: 5 })).rejects.toThrow(
      /Scheduling account/,
    );
    expect(state.committed.length).toBe(0);
  });
});

test("retry-now rejects missing, replaced, future and invalid-version schedules without publication", async () => {
  const current = post();
  const scheduled = {
    id: "schedule-1",
    postId: current.id,
    revisionId: "frozen",
    scheduledAt: NOW,
    scheduledBy: "actor",
  };
  const cases = [
    [[permission(), []], "NOT_FOUND"],
    [[permission(), [scheduled], [current], []], "CONFLICT"],
    [[permission(), [scheduled], [post({ version: 6 })]], "CONFLICT"],
    [[permission(), [scheduled], [post({ trashedAt: NOW })]], "VALIDATION"],
    [
      [permission(), [scheduled], [current], [{ ...scheduled, scheduledAt: new Date(NOW.getTime() + 1) }], clock()],
      "VALIDATION",
    ],
    [[permission(), [scheduled], [current], [scheduled], clock(), []], "NOT_FOUND"],
  ];
  for (const [reads, code] of cases)
    await withDatabase(reads, async (state) => {
      await expect(retryBlogSchedule("actor", { postId: current.id, version: current.version })).rejects.toMatchObject({
        code,
      });
      expect(state.committed.length).toBe(0);
    });
});

test("failed retry publication rolls back schedule removal and live changes when audit cannot be saved", async () => {
  const current = post();
  const frozen = revision(current);
  const scheduled = {
    id: "schedule-1",
    postId: current.id,
    revisionId: frozen.id,
    scheduledAt: NOW,
    scheduledBy: "actor",
  };
  await withDatabase(
    [permission(), [scheduled], [current], [scheduled], clock(), [frozen], [category], [tag]],
    async (state) => {
      await expect(retryBlogSchedule("actor", { postId: current.id, version: current.version })).rejects.toThrow(
        /simulated database write failure/,
      );
      expect(state.committed.length).toBe(0);
      expect(state.post.publishedRevisionId).toBe(current.publishedRevisionId);
      expect(state.post.version).toBe(current.version);
      expect(state.rolledBack.some((entry) => entry.table === schedules && entry.kind === "delete")).toBeTruthy();
    },
    { post: current, failWrite: (entry) => entry.table === auditEventsTable },
  );
});

test("scheduler leaves a cancelled or replaced request alone after re-reading it under lock", async () => {
  const current = post();
  const stale = {
    id: "old-schedule",
    postId: current.id,
    revisionId: "revision-2",
    scheduledAt: NOW,
    scheduledBy: "actor",
  };
  await withDatabase(
    [clock(), [stale], permission(), [current], [], [{ count: 1 }]],
    async (state) => {
      expect(await publishDueBlogPosts()).toEqual({
        attempted: 1,
        published: 0,
        failed: 0,
        remaining: 1,
      });
      expect(state.committed.length).toBe(0);
      const reread = state.readQueries.find(
        (entry) => entry.table === schedules && entry.condition?.params.includes(stale.id),
      );
      expect(reread, "the schedule is re-read using its request identity").toBeTruthy();
    },
    { post: current },
  );
});

test("revoked scheduling permissions preserve due work and scope failure diagnostics to request identity", async () => {
  const scheduled = {
    id: "old-schedule",
    postId: "post-1",
    revisionId: "revision-2",
    scheduledAt: NOW,
    scheduledBy: "actor",
  };
  await withDatabase([clock(), [scheduled], permission({ missing: "publish" }), [{ count: 1 }]], async (state) => {
    expect(await publishDueBlogPosts()).toEqual({
      attempted: 1,
      published: 0,
      failed: 1,
      remaining: 1,
    });
    const [diagnostic] = writes(state, schedules, "update");
    expect(diagnostic.values.lastErrorCode).toBe("PUBLISHER_FORBIDDEN");
    expect(diagnostic.condition.params).toEqual([scheduled.id]);
    expect(writes(state, posts).length).toBe(0);
    expect(writes(state, revisions).length).toBe(0);
  });
});

test("scheduler continues with other posts when diagnostic persistence also fails", async (t) => {
  const warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args));
  const first = {
    id: "schedule-1",
    postId: "post-1",
    revisionId: "revision-2",
    scheduledAt: NOW,
    scheduledBy: null,
  };
  const second = { ...first, id: "schedule-2", postId: "post-2" };
  await withDatabase(
    [clock(), [first, second], [{ count: 2 }]],
    async (state) => {
      expect(await publishDueBlogPosts()).toEqual({
        attempted: 2,
        published: 0,
        failed: 2,
        remaining: 2,
      });
      expect(state.attempts).toBe(2);
      expect(warnings.length).toBe(2);
      expect(warnings[0][1]).toEqual({
        postId: first.postId,
        scheduleId: first.id,
        code: "PUBLISHER_FORBIDDEN",
      });
    },
    { failWrite: (entry) => entry.table === schedules && entry.kind === "update" },
  );
});

test("scheduler does not reattempt the same post when rescheduling appears on a later batch", async () => {
  const firstBatch = Array.from({ length: 50 }, (_, index) => ({
    id: `schedule-${index}`,
    postId: `post-${index}`,
    revisionId: `revision-${index}`,
    scheduledAt: NOW,
    cursorTime: "2026-09-16T10:30:00.000123Z",
    scheduledBy: null,
  }));
  const replacement = { ...firstBatch[0], id: "zz-replacement-request" };
  await withDatabase([clock(), firstBatch, [replacement], [{ count: 50 }]], async (state) => {
    expect(await publishDueBlogPosts()).toEqual({
      attempted: 50,
      published: 0,
      failed: 50,
      remaining: 50,
    });
    expect(state.attempts).toBe(50);
    expect(writes(state, schedules, "update").length).toBe(50);
    expect(
      writes(state, schedules, "update").every((entry) => !entry.condition.params.includes(replacement.id)),
    ).toBeTruthy();
    const laterBatch = state.readQueries.filter((entry) => entry.table === schedules)[1];
    expect(
      laterBatch.condition.params.includes(firstBatch.at(-1).cursorTime),
      "cursor retains PostgreSQL microseconds",
    ).toBeTruthy();
  });
});
