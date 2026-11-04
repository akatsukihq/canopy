import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rows: {}, audits: [], uploaded: [], deleted: [] }));

vi.mock("../db/index.ts", () => {
  const table = (name) =>
    Object.fromEntries(
      ["name", "id", "ownerId", "integrationKey", "threadId", "runId", "status", "type"].map((key) => [
        key,
        key === "name" ? name : key,
      ]),
    );
  const tables = {
    assistantThreadsTable: table("threads"),
    assistantRunsTable: table("runs"),
    assistantAttachmentsTable: table("attachments"),
    assistantMessagesTable: table("messages"),
    blogPostsTable: table("posts"),
    authUser: table("users"),
  };
  const query = (execute) => {
    let predicate = () => true;
    let count = Infinity;
    let result;
    const chain = {
      where(value) {
        predicate = value;
        return chain;
      },
      for() {
        return chain;
      },
      limit(value) {
        count = value;
        return chain;
      },
      returning() {
        return chain;
      },
      then(resolve, reject) {
        try {
          result ??= execute(predicate).slice(0, count);
          return Promise.resolve(result).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return chain;
  };
  const database = {
    transaction(callback) {
      return callback(database);
    },
    select() {
      return {
        from(table) {
          return query((predicate) => fixture.rows[table.name].filter(predicate));
        },
      };
    },
    insert(table) {
      return {
        values(value) {
          return query(() => {
            const row = {
              type: "chat",
              settings: {},
              messageId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...value,
            };
            fixture.rows[table.name].push(row);
            return [row];
          });
        },
      };
    },
    update(table) {
      return {
        set(value) {
          return query((predicate) =>
            fixture.rows[table.name].filter(predicate).map((row) => Object.assign(row, value)),
          );
        },
      };
    },
    delete(table) {
      return query((predicate) => {
        const removed = fixture.rows[table.name].filter(predicate);
        fixture.rows[table.name] = fixture.rows[table.name].filter((row) => !predicate(row));
        return removed;
      });
    },
  };
  return {
    ...tables,
    db: database,
    // Runtime AI overrides read platform_settings only when a database is configured.
    isDatabaseConfigured: () => false,
    eq: (key, value) => (row) => row[key] === value,
    and:
      (...predicates) =>
      (row) =>
        predicates.every((predicate) => predicate(row)),
    desc: (value) => value,
    inArray: (key, values) => (row) => values.includes(row[key]),
    sql: () => () => true,
  };
});
vi.mock("server-only", () => ({}));
vi.mock("../lib/admin/index.ts", () => ({ requirePermission: async () => {} }));
vi.mock("../lib/blog/mutations.ts", () => ({ createBlogPostInTransaction: async () => {} }));
vi.mock("../lib/admin/adminMutations.ts", () => ({
  requireTransactionPermission: async () => {},
  writeAudit: async (...args) => {
    fixture.audits.push(args.slice(1));
  },
}));
vi.mock("../lib/config/config.ts", () => ({
  default: {
    ai: { enabled: true, provider: "openai", titleModel: "gpt-5.6-terra", openai: { model: "gpt-5.6-terra" } },
    cloudinary: { cloudName: "fixture" } },
}));
vi.mock("../lib/ai/client.ts", () => ({
  AIClient: class {
    async generate() {
      return { text: "Generated title", status: "completed" };
    }
    getCapabilities() {
      return { configured: true, images: true };
    }
    async uploadFile(input) {
      fixture.uploaded.push(input);
      return { id: "provider-file" };
    }
    async deleteFile(id) {
      fixture.deleted.push(id);
    }
  },
}));

const { createAssistantThreads } = await import("../lib/assistant/threads.ts");
const assistant = createAssistantThreads({
  key: "blog",
  defaultSettings: {},
  validateSettings: (value) => value,
  authorize: async () => {},
  audit: { prefix: "blog", resourcePrefix: "blog", resourceMetadata: (postId) => ({ postId }) },
});

beforeEach(() => {
  fixture.rows = { threads: [], runs: [], attachments: [], messages: [], posts: [], users: [] };
  fixture.audits = [];
  fixture.uploaded = [];
  fixture.deleted = [];
});

async function thread() {
  const created = await assistant.createThread("author", "post", { title: "Research" });
  fixture.audits = [];
  return created;
}

test("creating an assistant conversation persists it without an audit event", async () => {
  const created = await assistant.createThread("author", "post", { title: "Research" });
  assert.equal(created.title, "Research");
  assert.equal(fixture.rows.threads[0].id, created.id);
  assert.deepEqual(fixture.audits, []);
});

test("adding assistant reference links persists them without an audit event", async () => {
  const created = await thread();
  const link = await assistant.createLinkAttachment("author", "post", created.id, {
    type: "link",
    url: "https://example.com/reference",
  });
  assert.equal(link.data.url, "https://example.com/reference");
  assert.equal(fixture.rows.attachments[0].id, link.id);
  assert.deepEqual(fixture.audits, []);
});

test("uploading and removing assistant images preserves provider cleanup without audit events", async () => {
  const created = await thread();
  const image = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "reference.png", { type: "image/png" });
  const uploaded = await assistant.uploadAttachment("author", "post", created.id, image);
  assert.equal(uploaded.status, "ready");
  assert.equal(fixture.uploaded.length, 1);
  assert.equal(fixture.rows.attachments[0].data.provider.fileId, "provider-file");
  assert.deepEqual(fixture.audits, []);
  await assistant.removeAttachment("author", "post", created.id, uploaded.id);
  assert.deepEqual(fixture.rows.attachments, []);
  assert.deepEqual(fixture.deleted, ["provider-file"]);
  assert.deepEqual(fixture.audits, []);
});

test("clearing assistant history retains the conversation and removes private references without auditing", async () => {
  const created = await thread();
  await assistant.createLinkAttachment("author", "post", created.id, {
    type: "link",
    url: "https://example.com/reference",
  });
  fixture.rows.messages.push({ id: "message", threadId: created.id });
  fixture.audits = [];
  await assistant.removeThreadHistory("author", "post", created.id);
  assert.equal(fixture.rows.threads.length, 1);
  assert.deepEqual(fixture.rows.attachments, []);
  assert.deepEqual(fixture.rows.messages, []);
  assert.deepEqual(fixture.rows.threads[0].settings.composerState.attachmentIds, []);
  assert.deepEqual(fixture.audits, []);
});

const { blogAssistantIntegration } = await import("../lib/blog/assistantIntegration.ts");
const { createBlogDocument, blogDocumentHash } = await import("../lib/blog/document.ts");
const { db } = await import("../db/index.ts");

function post() {
  const document = createBlogDocument("Untitled");
  fixture.rows.posts.push({ id: "post", draftDocument: document, draftHash: blogDocumentHash(document), version: 1 });
  return document;
}

test("assistant generation audits the actual saved article instead of its run", async () => {
  const document = post();
  await blogAssistantIntegration.complete(
    db,
    { resourceId: "post", ownerId: "author" },
    { resourceData: { ...document, title: "Generated article" } },
  );
  assert.equal(fixture.rows.posts[0].draftDocument.title, "Generated article");
  assert.equal(fixture.rows.posts[0].version, 2);
  assert.equal(fixture.audits.length, 1);
  assert.deepEqual(fixture.audits[0].slice(0, 4), ["author", "blog.save", "blog_post", "post"]);
});

test("assistant completion without article changes does not emit audits", async () => {
  await blogAssistantIntegration.complete(db, { resourceId: "post", ownerId: "author" }, {});
  assert.deepEqual(fixture.rows.posts, []);
  assert.deepEqual(fixture.audits, []);
});

test("assistant title generation audits the saved article", async () => {
  post();
  const run = {
    id: "run",
    resourceId: "post",
    ownerId: "author",
    operation: "generate",
    provider: "openai",
    status: "running",
    request: { message: "Draft an article" },
  };
  await blogAssistantIntegration.auxiliary(run, new AbortController().signal, async () => run);
  assert.equal(fixture.rows.posts[0].draftDocument.title, "Generated title");
  assert.equal(fixture.rows.posts[0].version, 2);
  assert.equal(fixture.audits.length, 1);
  assert.deepEqual(fixture.audits[0].slice(0, 4), ["author", "blog.save", "blog_post", "post"]);
});

const { createAssistantRuns } = await import("../lib/assistant/runs.ts");

test("recording proposal decisions updates the run and message without audit events", async () => {
  const created = await thread();
  const proposal = { id: "suggestion", status: "pending", title: "Improve introduction", data: {} };
  fixture.rows.runs.push({
    id: "run",
    ownerId: "author",
    integrationKey: "blog",
    resourceId: "post",
    threadId: created.id,
    status: "completed",
    operation: "chat",
    continuation: {},
    request: { schemaVersion: 1, clientRequestId: "request", operation: "chat", message: "Improve this article" },
    response: { text: "Suggested improvement", citations: [], proposals: [proposal] },
  });
  fixture.rows.messages.push({
    id: "message",
    runId: "run",
    threadId: created.id,
    parts: [{ type: "proposal", proposal }],
  });
  const executions = createAssistantRuns({ key: "blog" }, { ...assistant, runView: (run) => run });
  const updated = await executions.updateProposal("author", "run", "suggestion", { status: "discarded" });
  assert.equal(updated.response.proposals[0].status, "discarded");
  assert.equal(fixture.rows.messages[0].parts[0].proposal.status, "discarded");
  assert.deepEqual(fixture.audits, []);
});
