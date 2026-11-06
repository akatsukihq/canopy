import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const finish = (unified) => ({ type: "finish", finishReason: { unified, raw: unified }, usage });
/** Each call to the mock model answers with the next scripted step. */
function scriptedModel(steps) {
  const prompts = [];
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      const step = steps.shift();
      return { stream: simulateReadableStream({ chunks: [{ type: "stream-start", warnings: [] }, ...step] }) };
    },
  });
  return { model, prompts };
}
const askToDelete = [
  { type: "tool-call", toolCallId: "call-1", toolName: "deleteFile", input: JSON.stringify({ path: "a.txt" }) },
  finish("tool-calls"),
];
const answer = (text) => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];

async function runLoop(model, request) {
  const { sdkOptions, streamEvents, resultFromSteps } = await import("../lib/ai/providers/sdk.ts");
  const build = (next) => sdkOptions(next, { name: "test", model, webSearch: () => ({}), providerOptions: {} });
  const events = [];
  for await (const event of streamEvents(request, build, {
    handle: () => null,
    result: (steps, total) => resultFromSteps("test", steps, total, request, []),
  }))
    events.push(event);
  return events.find((event) => event.type === "completed").result;
}

function deleteRequest(executed) {
  return {
    messages: [{ role: "user", content: "Delete a.txt" }],
    tools: {
      deleteFile: {
        description: "Deletes a file",
        inputSchema: z.object({ path: z.string() }),
        needsApproval: true,
        execute: async (input) => {
          executed.push(input);
          return { deleted: input.path };
        },
      },
    },
  };
}

test("a tool that needs approval pauses the loop, then approval runs it and rejection denies it", async () => {
  const executed = [];
  const first = scriptedModel([askToDelete]);
  const paused = await runLoop(first.model, deleteRequest(executed));
  assert.equal(paused.status, "failed");
  assert.equal(paused.error.code, "APPROVAL_REQUIRED");
  assert.equal(executed.length, 0);
  assert.equal(paused.approval.requests.length, 1);
  const [pending] = paused.approval.requests;
  assert.equal(pending.toolName, "deleteFile");
  assert.deepEqual(pending.input, { path: "a.txt" });
  assert.ok(paused.approval.messages.length > 0);

  const approved = scriptedModel([answer("Deleted it.")]);
  const resumed = await runLoop(approved.model, {
    ...deleteRequest(executed),
    resume: { messages: paused.approval.messages, responses: [{ approvalId: pending.approvalId, approved: true }] },
  });
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.text, "Deleted it.");
  assert.deepEqual(executed, [{ path: "a.txt" }]);
  const toolResult = approved.prompts[0].flatMap((message) => (message.role === "tool" ? message.content : []));
  assert.ok(toolResult.some((part) => part.type === "tool-result" && part.output.value?.deleted === "a.txt"));

  const rejected = scriptedModel([answer("Left it alone.")]);
  const denied = await runLoop(rejected.model, {
    ...deleteRequest(executed),
    resume: {
      messages: paused.approval.messages,
      responses: [{ approvalId: pending.approvalId, approved: false, reason: "Keep it" }],
    },
  });
  assert.equal(denied.status, "completed");
  assert.equal(executed.length, 1);
  const deniedResult = rejected.prompts[0]
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .find((part) => part.type === "tool-result");
  assert.equal(deniedResult.output.type, "execution-denied");
  assert.equal(deniedResult.output.reason, "Keep it");
});

test("resuming with unusable saved messages fails with a clear error", async () => {
  const { model } = scriptedModel([answer("unused")]);
  await assert.rejects(
    runLoop(model, {
      ...deleteRequest([]),
      resume: { messages: [{ role: "nobody" }], responses: [{ approvalId: "x", approved: true }] },
    }),
    { code: "VALIDATION" },
  );
});

const url = process.env.BLOG_TEST_DATABASE_URL;
test.skipIf(!url)("paused runs persist, continue once per decision, and stay private", async (t) => {
  const schema = `assistant_approval_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const target = new URL(url);
  target.searchParams.set("options", `-c search_path=${schema}`);
  const previous = Object.fromEntries(
    ["DATABASE_URL", "AI_ENABLED", "OPENAI_API_KEY"].map((key) => [key, process.env[key]]),
  );
  process.env.DATABASE_URL = target.toString();
  process.env.AI_ENABLED = "true";
  process.env.OPENAI_API_KEY = "fixture-only";
  const pool = new pg.Pool({ connectionString: target.toString(), max: 3 });
  const { AIClient } = await import("../lib/ai/client.ts");
  const original = Object.fromEntries(
    ["stream", "generate", "deleteResponse"].map((key) => [key, AIClient.prototype[key]]),
  );
  const { sqlClient } = await import("../db/index.ts");
  t.onTestFinished(async () => {
    await sqlClient.end();
    await pool.end();
    Object.assign(AIClient.prototype, original);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  // Every migration, so the approval status check is the one under test.
  const root = new URL("../db/migration/", import.meta.url);
  for (const folder of (await readdir(root)).sort())
    for (const file of (await readdir(new URL(`${folder}/`, root))).filter((name) => name.endsWith(".sql")).sort())
      await pool.query(await readFile(new URL(`${folder}/${file}`, root), "utf8"));
  await pool.query(
    "INSERT INTO auth_users(id,name,email) VALUES ('a','A','a@test.invalid'),('b','B','b@test.invalid')",
  );
  await pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('a','admin'),('b','admin')");

  const requests = [];
  const savedLoop = [{ role: "assistant", content: [{ type: "text", text: "Checking" }] }];
  const base = { provider: "openai", model: "fixture", toolCalls: [], citations: [], metadata: {}, output: null };
  const usageTotals = { inputTokens: 2, outputTokens: 1, totalTokens: 3 };
  AIClient.prototype.stream = async function* (request) {
    requests.push(request);
    const id = randomUUID();
    yield { type: "response", response: { id, provider: "openai", model: "fixture", status: "running" } };
    const result = request.resume
      ? {
          ...base,
          id,
          status: "completed",
          text: request.resume.responses[0].approved ? "Done" : "Skipped",
          usage: usageTotals,
        }
      : {
          ...base,
          id,
          status: "failed",
          text: "",
          usage: usageTotals,
          error: { code: "APPROVAL_REQUIRED", message: "Needs approval" },
          approval: {
            requests: [{ approvalId: "ap-1", toolCallId: "call-1", toolName: "publishPost", input: { slug: "hello" } }],
            messages: savedLoop,
          },
        };
    yield { type: "completed", result };
  };
  AIClient.prototype.generate = async () => ({
    ...base,
    id: randomUUID(),
    status: "completed",
    text: "Title",
    usage: usageTotals,
  });
  AIClient.prototype.deleteResponse = async () => {};
  const { createAssistantService } = await import("../lib/assistant/service.ts");
  const { blogAssistantIntegration } = await import("../lib/blog/assistantIntegration.ts");
  // Chat runs never pause in production; this test integration lets them, to exercise the runtime alone.
  const assistant = createAssistantService({ ...blogAssistantIntegration, approvals: () => true });
  const { createBlogPost } = await import("../lib/blog/mutations.ts");
  const post = await createBlogPost("a", { title: "Draft" });
  const readEvents = async (response) => (await response.text()).trim().split("\n").filter(Boolean).map(JSON.parse);
  const pause = async () => {
    const thread = await assistant.createThread("a", post.id, {});
    const events = await readEvents(
      await assistant.streamRun(
        "a",
        {
          clientRequestId: randomUUID(),
          operation: "chat",
          message: "Publish it",
          resourceId: post.id,
          threadId: thread.id,
          context: { editorJson: post.draftDocument.body },
        },
        new AbortController().signal,
      ),
    );
    const completed = events.find((event) => event.type === "completed");
    assert.ok(completed, JSON.stringify(events));
    return completed.run;
  };
  const respond = async (actor, id, body) =>
    readEvents(await assistant.respondToApproval(actor, id, body, new AbortController().signal));
  const finished = (events) => events.find((event) => event.type === "completed")?.run;

  // Pause: the run waits with its tool call visible and the loop saved privately.
  const paused = await pause();
  assert.equal(paused.status, "awaiting-approval");
  assert.deepEqual(paused.approval.calls, [
    { toolCallId: "call-1", toolName: "publishPost", input: { slug: "hello" } },
  ]);
  const reloaded = await assistant.getRun("a", paused.id);
  assert.equal(reloaded.status, "awaiting-approval");
  assert.equal(reloaded.approval.calls[0].toolName, "publishPost");
  assert.equal(JSON.stringify(reloaded).includes("Checking"), false);

  // Wrong user: someone else's paused run does not exist for them.
  await assert.rejects(respond("b", paused.id, { approved: true }), { code: "NOT_FOUND" });

  // Approve-continue: the same loop resumes with the decision appended.
  const approvedRun = finished(await respond("a", paused.id, { approved: true }));
  assert.equal(approvedRun.status, "completed");
  assert.notEqual(approvedRun.id, paused.id);
  const resumed = requests.at(-1).resume;
  assert.deepEqual(resumed.messages, savedLoop);
  assert.deepEqual(resumed.responses, [{ approvalId: "ap-1", approved: true }]);
  const decided = await assistant.getRun("a", paused.id);
  assert.equal(decided.approval.decision, "approved");

  // Double-respond: the same decision replays without another provider call; a different one conflicts.
  const calls = requests.length;
  const replay = await respond("a", paused.id, { approved: true });
  assert.equal(replay.find((event) => event.type === "run" || event.type === "completed")?.run.id, approvedRun.id);
  assert.equal(requests.length, calls);
  await assert.rejects(respond("a", paused.id, { approved: false }), { code: "CONFLICT" });

  // Reject-continue: the reason reaches the agent and the run finishes normally.
  const second = await pause();
  const rejectedRun = finished(await respond("a", second.id, { approved: false, reason: "Not yet" }));
  assert.equal(rejectedRun.status, "completed");
  assert.deepEqual(requests.at(-1).resume.responses, [{ approvalId: "ap-1", approved: false, reason: "Not yet" }]);
  assert.equal((await assistant.getRun("a", second.id)).approval.decision, "rejected");
});
