import { setImmediate } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { streamAssistantRun } from "../lib/assistant/client.ts";

const originalFetch = globalThis.fetch;
const request = {
  operation: "chat",
  clientRequestId: "request",
  message: "Hello",
  editorJson: { type: "doc", content: [] },
};
const run = { id: "run", status: "completed" };
const encode = (value) => new TextEncoder().encode(JSON.stringify(value) + "\n");
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("delivers split UTF-8 text and structured snapshots before the completion event", async () => {
  let controller;
  const body = new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    expect(JSON.parse(options.body)).toEqual(request);
    return new Response(body);
  };
  const events = [];
  const pending = streamAssistantRun("fixture", request, new AbortController().signal, (event) => events.push(event));
  const bytes = encode({ type: "text-delta", text: "Hi 👋" });
  const split = bytes.indexOf(0xf0) + 2;
  controller.enqueue(bytes.slice(0, split));
  controller.enqueue(bytes.slice(split));
  controller.enqueue(encode({ type: "text", text: "Partial replacement" }));
  await setImmediate();
  expect(events.map((event) => event.text)).toEqual(["Hi 👋", "Partial replacement"]);
  controller.enqueue(encode({ type: "completed", run }));
  controller.close();
  expect(await pending).toEqual(run);
  expect(calls).toBe(1);
});

test("truncated streams fail without polling or silently retrying", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(encode({ type: "text-delta", text: "Partial" }));
  };
  await expect(streamAssistantRun("fixture", request, new AbortController().signal, () => {})).rejects.toThrow(
    /connection dropped before the reply finished/,
  );
  expect(calls).toBe(1);
});

test("abort releases a waiting reader and suppresses late presentation", async () => {
  let cancelled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
  const abort = new AbortController();
  const events = [];
  const pending = streamAssistantRun("fixture", request, abort.signal, (event) => events.push(event));
  await setImmediate();
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancelled).toBe(true);
  expect(events).toEqual([]);
});

test("HTTP rejection and streamed failure preserve the server's recovery message", async () => {
  globalThis.fetch = async () => Response.json({ error: "Thread not found" }, { status: 404 });
  await expect(streamAssistantRun("fixture", request, new AbortController().signal, () => {})).rejects.toMatchObject({
    status: 404,
    message: "Thread not found",
  });
  const failure = { type: "error", message: "Provider stopped", run: { ...run, status: "failed" } };
  globalThis.fetch = async () => new Response(encode(failure));
  const events = [];
  await expect(
    streamAssistantRun("fixture", request, new AbortController().signal, (event) => events.push(event)),
  ).rejects.toThrow(/Provider stopped/);
  expect(events).toEqual([failure]);
});
