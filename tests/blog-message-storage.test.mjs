import { expect, test, vi } from "vitest";

const errorMatch = (error, matcher) => {
  if (matcher === undefined) return;
  if (typeof matcher === "function") {
    if (matcher.prototype instanceof Error || matcher === Error) expect(error).toBeInstanceOf(matcher);
    else expect(matcher(error)).toBeTruthy();
  } else if (matcher instanceof RegExp) expect(error.message).toMatch(matcher);
  else expect(error).toMatchObject(matcher);
};
async function assertRejects(input, matcher) {
  const promise = typeof input === "function" ? input() : input;
  let error;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, "expected rejection").toBeDefined();
  errorMatch(error, matcher);
}

vi.mock("server-only", () => ({}));

const { createAssistantService } = await import("../lib/assistant/service.ts");
const { blogAssistantIntegration } = await import("../lib/blog/assistantIntegration.ts");
const { attachmentProvider } = await import("../lib/assistant/resources.ts");
const { attachmentView, messageView, attachmentsForRun, startRun } = createAssistantService(blogAssistantIntegration);
const { db, assistantThreadsTable, assistantMessagesTable, assistantRunsTable, authUser, blogPostsTable } =
  await import("../db/index.ts");
const { AIClient } = await import("../lib/ai/client.ts");
const { ADMIN_ACCESS } = await import("../lib/authorization/index.ts");
const date = new Date("2026-09-18T00:00:00Z");
const attachment = {
  id: "file",
  threadId: "thread",
  messageId: null,
  ownerId: "owner",
  type: "file",
  label: "image.png",
  data: {
    mimeType: "image/png",
    sizeBytes: 128,
    storageKey: "private/key",
    provider: { name: "openai", fileId: "private-file", details: { secret: "not-for-client" } },
  },
  status: "ready",
  expiresAt: null,
  createdAt: date,
  updatedAt: date,
};

test("attachment views expose display fields without provider/storage credentials", () => {
  const view = attachmentView(attachment);
  expect(view.data).toEqual({ mimeType: "image/png", sizeBytes: 128 });
  expect(view.expiresAt).toBe(null);
  expect(attachmentView({ ...attachment, type: "link", data: { url: "javascript:alert(1)" } }).data.url).toBe(
    undefined,
  );
  expect(attachmentProvider(attachment.data)).toEqual({ name: "openai", fileId: "private-file" });
  expect(attachmentProvider({ provider: { fileId: "missing-provider-name" } })).toBe(null);
  expect(attachmentProvider({ provider: null })).toBe(null);
});
test("message views preserve content and usage but omit raw provider details", () => {
  const parts = [{ type: "text", text: "Answer" }];
  const view = messageView({
    id: "m",
    threadId: "t",
    runId: "r",
    role: "assistant",
    parts,
    meta: {
      usage: { totalTokens: 12 },
      provider: { name: "openai", model: "configured", responseId: "private", details: { headers: "private" } },
    },
    createdAt: date,
    updatedAt: date,
  });
  expect(view.parts).toEqual(parts);
  expect(view.meta).toEqual({ usage: { totalTokens: 12 }, provider: { name: "openai", model: "configured" } });
});
function transaction(rows) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return { for: async () => rows };
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return { where: async () => {} };
        },
      };
    },
  };
}
test("attachment preparation allows links and same-input retry but rejects cross-message reuse", async () => {
  const link = { ...attachment, id: "link", type: "link", data: { url: "https://openai.com/article" } };
  expect((await attachmentsForRun(transaction([link]), "owner", "thread", "other-provider", ["link"])).length).toBe(1);
  const sent = { ...attachment, messageId: "input" };
  await assertRejects(attachmentsForRun(transaction([sent]), "owner", "thread", "openai", ["file"]), /unavailable/i);
  expect((await attachmentsForRun(transaction([sent]), "owner", "thread", "openai", ["file"], "input")).length).toBe(1);
  for (const row of [
    { ...attachment, status: "processing" },
    { ...attachment, expiresAt: new Date(0) },
    { ...attachment, data: { provider: { name: "openai" } } },
    { ...attachment, type: "unsupported" },
  ])
    await assertRejects(attachmentsForRun(transaction([row]), "owner", "thread", "openai", ["file"]), /unavailable/i);
  await assertRejects(
    attachmentsForRun(transaction([attachment]), "owner", "thread", "different", ["file"]),
    /unavailable/i,
  );
});

test("sending messages keeps an unnamed thread unnamed until the title model names it", async () => {
  const previous = {
    transaction: db.transaction,
    enabled: process.env.AI_ENABLED,
    capabilities: AIClient.prototype.getCapabilities,
  };
  const thread = {
    id: "thread",
    integrationKey: "blog",
    resourceId: "post",
    ownerId: "owner",
    title: "New thread",
    type: "chat",
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const permission = [
    {
      status: "active",
      roleId: "admin",
      roleName: "Admin",
      roleDescription: "Admin",
      roleAccess: ADMIN_ACCESS,
      roleIsSystem: true,
    },
  ];
  const userMessages = [];
  const savedRuns = [];
  const tx = {
    execute: async () => {},
    select(fields) {
      let source;
      const chain = {
        from(table) {
          source = table;
          return chain;
        },
        where: () => chain,
        innerJoin: () => chain,
        for: () => chain,
        limit: () => chain,
        then(resolve, reject) {
          // Route fixture reads by the selected table, not authorization/read order.
          let rows;
          if (source === authUser) rows = permission;
          else if (source === blogPostsTable) rows = [{ id: "post", trashedAt: null }];
          else if (source === assistantThreadsTable) rows = [thread];
          else if (source === assistantMessagesTable) rows = userMessages.map(({ id }) => ({ id }));
          else if (source === assistantRunsTable) rows = fields ? savedRuns.map(({ id }) => ({ id })) : [];
          else throw new Error("Unexpected database table read");
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
    insert(table) {
      return {
        values(value) {
          if (table === assistantMessagesTable && value.role === "user") userMessages.push(value);
          const row = { createdAt: date, updatedAt: date, completedAt: null, ...value };
          if (table === assistantRunsTable) savedRuns.push(row);
          return { returning: async () => [row] };
        },
      };
    },
    update(table) {
      return {
        set(value) {
          return {
            where: async () => {
              if (table === assistantThreadsTable) Object.assign(thread, value);
            },
          };
        },
      };
    },
  };
  db.transaction = async (callback) => callback(tx);
  process.env.AI_ENABLED = "true";
  AIClient.prototype.getCapabilities = () => ({ configured: true, model: "fixture", images: true });
  try {
    for (const [index, message] of ["How can I improve\n this draft?", "Now shorten the introduction"].entries()) {
      const { run } = await startRun("owner", {
        operation: "chat",
        clientRequestId: `request-${index}`,
        resourceId: "post",
        threadId: "thread",
        message,
        context: { editorJson: { type: "doc", content: [] } },
      });
      expect(run.status).toBe("queued");
      // The title model names the thread beside the reply; sending never derives a title from the raw message.
      expect(thread.title).toBe("New thread");
      expect(userMessages.length).toBe(index + 1);
      expect(savedRuns[index].integrationKey).toBe("blog");
      expect(savedRuns[index].resourceId).toBe("post");
      expect(savedRuns[index].executionMode).toBe("conversational");
    }
  } finally {
    db.transaction = previous.transaction;
    if (previous.enabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous.enabled;
    AIClient.prototype.getCapabilities = previous.capabilities;
  }
});

test("agent reuse accepts prior sources but artifacts remain immutable and expire before reuse", async () => {
  const sent = { ...attachment, messageId: "old-message" };
  expect(
    (await attachmentsForRun(transaction([sent]), "owner", "thread", "openai", ["file"], undefined, true)).length,
  ).toBe(1);
  const artifact = {
    ...attachment,
    id: "report",
    type: "artifact",
    messageId: null,
    data: {
      artifact: {
        schemaVersion: 1,
        agentVersion: 1,
        agentId: "auditor",
        summary: "Review",
        inputArtifactIds: [],
        content: { sections: [{ heading: "Structure", text: "Clear" }] },
      },
    },
  };
  expect((await attachmentsForRun(transaction([artifact]), "owner", "thread", "openai", ["report"])).length).toBe(1);
  await assertRejects(
    attachmentsForRun(
      transaction([{ ...artifact, expiresAt: new Date(0) }]),
      "owner",
      "thread",
      "openai",
      ["report"],
      undefined,
      true,
    ),
    /unavailable/,
  );
  await assertRejects(
    attachmentsForRun(
      transaction([{ ...artifact, data: { artifact: { ...artifact.data.artifact, schemaVersion: 2 } } }]),
      "owner",
      "thread",
      "openai",
      ["report"],
      undefined,
      true,
    ),
    /unavailable/,
  );
});
