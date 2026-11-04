import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AIClient } from "@/lib/ai/client.ts";
import { AIError } from "@/lib/ai/errors.ts";
import { AI_PROVIDERS, listModels } from "@/lib/ai/models.ts";

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
  expect(AI_PROVIDERS).toEqual(["openai", "anthropic"]);
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

test("an explicit API key configures each provider without env", () => {
  for (const provider of AI_PROVIDERS) {
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
