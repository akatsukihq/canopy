import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AIClient } from "@/lib/ai/client.ts";
import { AIError } from "@/lib/ai/errors.ts";
import { AI_PROVIDERS, effortLevels, listModels, pickerModels } from "@/lib/ai/models.ts";

const KEY = "sk-secret-fixture-key";
const ENV = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls;

function mockFetch(responder) {
  calls = [];
  vi.stubGlobal("fetch", async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return responder(String(url), options);
  });
}

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV) if (saved[name] === undefined) delete process.env[name];
  else process.env[name] = saved[name];
});

test("exports the supported providers", () => {
  expect(AI_PROVIDERS).toEqual(["openai", "anthropic", "compatible"]);
});

test("OpenAI model list keeps chat models only, sorted and deduplicated", async () => {
  const ids = [
    "gpt-5.6-terra",
    "o3-mini",
    "chatgpt-4o-latest",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-transcribe",
    "gpt-4o-mini-tts",
    "gpt-image-1",
    "text-embedding-3-small",
    "omni-moderation-latest",
    "gpt-4o-search-preview",
    "dall-e-3",
    "whisper-1",
    "o1",
    "o4-mini",
    "o1",
  ];
  mockFetch(() => json({ data: ids.map((id) => ({ id })) }));
  expect(await listModels("openai", KEY)).toEqual(["chatgpt-4o-latest", "gpt-5.6-terra", "o1", "o3-mini", "o4-mini"]);
  expect(calls[0].url).toBe("https://api.openai.com/v1/models");
  expect(calls[0].options.headers.authorization).toBe(`Bearer ${KEY}`);
});

test("Anthropic model list follows pagination", async () => {
  mockFetch((url) =>
    new URL(url).searchParams.get("after_id") === "claude-b"
      ? json({ data: [{ id: "claude-a" }, { id: "claude-c" }], has_more: false, last_id: "claude-c" })
      : json({ data: [{ id: "claude-b" }], has_more: true, last_id: "claude-b" }),
  );
  expect(await listModels("anthropic", KEY)).toEqual(["claude-a", "claude-b", "claude-c"]);
  expect(calls).toHaveLength(2);
  expect(calls[0].options.headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
});

test("a rejected key maps to a configuration error without leaking the key or body", async () => {
  for (const status of [401, 403]) {
    mockFetch(() => json({ error: { message: `Incorrect API key provided: ${KEY}` } }, status));
    const error = await listModels("openai", KEY).catch((failure) => failure);
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({ code: "CONFIGURATION", status: 400, message: "The API key was rejected." });
    expect(JSON.stringify({ message: error.message, cause: String(error.cause) })).not.toContain(KEY);
  }
});

test("other upstream failures never expose the key or body", async () => {
  mockFetch(() => new Response(`server exploded for ${KEY}`, { status: 500 }));
  const failed = await listModels("anthropic", KEY).catch((failure) => failure);
  expect(failed).toMatchObject({ code: "PROVIDER", status: 502 });
  expect(failed.message).not.toContain(KEY);

  mockFetch(() => Promise.reject(new TypeError(`connect failed ${KEY}`)));
  const unreachable = await listModels("openai", KEY).catch((failure) => failure);
  expect(unreachable).toMatchObject({ code: "PROVIDER" });
  expect(unreachable.message).not.toContain(KEY);
});

test("an explicit API key configures each keyed provider without env", () => {
  for (const provider of ["openai", "anthropic"]) {
    expect(new AIClient(provider).getCapabilities().configured).toBe(false);
    expect(new AIClient(provider, { apiKey: KEY }).getCapabilities()).toMatchObject({ provider, configured: true });
  }
  expect(new AIClient("anthropic").model).toBe("claude-sonnet-5-5");
  process.env.ANTHROPIC_API_KEY = "env-key";
  expect(new AIClient("anthropic").getCapabilities().configured).toBe(true);
});

test("unknown providers are rejected", () => {
  expect(() => new AIClient("gemini")).toThrow(AIError);
  expect(() => new AIClient("__proto__")).toThrow("This AI provider is not supported.");
});

test("Anthropic generate uses the supplied key and model", async () => {
  mockFetch(() =>
    json({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "Hello from Claude" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 3 },
    }),
  );
  const result = await new AIClient("anthropic", { apiKey: KEY, model: "claude-test" }).generate({
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ],
  });
  expect(result).toMatchObject({
    id: "msg_fixture",
    provider: "anthropic",
    status: "completed",
    text: "Hello from Claude",
    usage: { inputTokens: 2, outputTokens: 3 },
  });
  expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
  const headers = new Headers(calls[0].options.headers);
  expect(headers.get("x-api-key")).toBe(KEY);
  expect(JSON.parse(calls[0].options.body)).toMatchObject({ model: "claude-test" });
});

test("OpenAI-compatible model list uses the base URL and sends a key only when given", async () => {
  mockFetch(() => json({ data: [{ id: "llama-3" }, { id: "qwen" }, { id: "llama-3" }] }));
  expect(await listModels("compatible", "", undefined, "http://localhost:11434/v1/")).toEqual(["llama-3", "qwen"]);
  expect(calls[0].url).toBe("http://localhost:11434/v1/models");
  expect(calls[0].options.headers).toEqual({});
  await listModels("compatible", KEY, undefined, "https://openrouter.ai/api/v1");
  expect(calls[1].options.headers).toEqual({ authorization: `Bearer ${KEY}` });
  await expect(listModels("compatible", KEY)).rejects.toBeInstanceOf(AIError);
});

test("OpenAI-compatible is configured by base URL and model, not by key", () => {
  const ready = new AIClient("compatible", { baseUrl: "http://localhost:11434/v1", model: "llama-3", apiKey: "" });
  expect(ready.getCapabilities()).toMatchObject({ configured: true, webSearch: false, images: false });
  expect(new AIClient("compatible", { baseUrl: "", model: "llama-3" }).getCapabilities().configured).toBe(false);
});

test("OpenAI-compatible generate posts chat completions to the base URL", async () => {
  mockFetch(() =>
    json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "llama-3",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
  const client = new AIClient("compatible", { baseUrl: "http://localhost:11434/v1", model: "llama-3" });
  const result = await client.generate({ messages: [{ role: "user", content: "Hello" }] });
  expect(result.text).toBe("Hi");
  expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
  expect(JSON.parse(calls[0].options.body).model).toBe("llama-3");
});

test("each model offers only the efforts it accepts", () => {
  expect(effortLevels("anthropic", "claude-opus-5-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(effortLevels("anthropic", "claude-haiku-5-5")).toEqual(["low", "medium", "high"]);
  expect(effortLevels("anthropic", "claude-3-5-haiku-latest")).toEqual([]);
  expect(effortLevels("openai", "gpt-5.6-terra")).toEqual(["low", "medium", "high"]);
  expect(effortLevels("openai", "gpt-4.1")).toEqual([]);
  expect(effortLevels("openai", "gpt-6.1-sol")).toEqual(["low", "medium", "high"]);
  expect(effortLevels("openai", "gpt-5-chat-latest")).toEqual([]);
  expect(effortLevels("compatible", "o4-mini")).toEqual([]);
});

test("the assistant picker offers a short, readable model list", () => {
  const anthropic = pickerModels(
    "anthropic",
    [
      { id: "claude-3-5-haiku-20241022", name: "Claude Haiku 3.5" },
      { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
      { id: "claude-opus-5", name: "Claude Opus 5" },
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-sonnet-5-5-20260901", name: "Claude Sonnet 5.5" },
    ],
    "claude-opus-4-8",
  );
  // Newest Opus versions, snapshots and Claude 3 dropped.
  expect(anthropic.map((model) => model.name)).toEqual([
    "Claude Opus 5.5",
    "Claude Opus 5",
    "Claude Opus 4.8",
    "Claude Sonnet 5.5",
  ]);
  const openai = pickerModels("openai", [{ id: "gpt-4.1" }, { id: "gpt-5.6-terra" }, { id: "o3" }], "gpt-5.6-terra");
  expect(openai).toEqual([{ id: "gpt-5.6-terra", name: "GPT-5.6 Terra", efforts: ["low", "medium", "high"] }]);
  expect(pickerModels("compatible", [{ id: "llama-3" }], "llama-3")).toEqual([{ id: "llama-3", name: "llama-3", efforts: [] }]);
});

test("Anthropic effort turns on readable thinking and streams it as reasoning", async () => {
  const sse = [
    ["message_start", { type: "message_start", message: { id: "msg_t", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Checking the title length." } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done." } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  mockFetch(() => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
  const events = [];
  for await (const event of new AIClient("anthropic", { apiKey: KEY, model: "claude-sonnet-5" }).stream({
    messages: [{ role: "user", content: "Hi" }],
    effort: "high",
  }))
    events.push(event);
  const body = JSON.parse(calls[0].options.body);
  expect(body.thinking).toMatchObject({ type: "adaptive", display: "summarized" });
  expect(body.output_config).toMatchObject({ effort: "high" });
  expect(events.filter((event) => event.type === "reasoning-delta").map((event) => event.text)).toEqual([
    "Checking the title length.",
  ]);
  expect(events.at(-1)).toMatchObject({ type: "completed", result: { text: "Done." } });
});

test("requests without effort leave the provider's reasoning settings alone", async () => {
  mockFetch(() =>
    json({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
  await new AIClient("anthropic", { apiKey: KEY, model: "claude-sonnet-5" }).generate({
    messages: [{ role: "user", content: "Hi" }],
  });
  const body = JSON.parse(calls[0].options.body);
  expect(body.thinking).toBeUndefined();
  expect(body.output_config?.effort).toBeUndefined();
});

test("Max effort reaches Anthropic as its own effort with readable thinking", async () => {
  mockFetch(() =>
    json({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
  await new AIClient("anthropic", { apiKey: KEY, model: "claude-opus-5" }).generate({
    messages: [{ role: "user", content: "Hi" }],
    effort: "max",
  });
  const body = JSON.parse(calls[0].options.body);
  expect(body.thinking).toMatchObject({ type: "adaptive", display: "summarized" });
  expect(body.output_config).toMatchObject({ effort: "max" });
});
