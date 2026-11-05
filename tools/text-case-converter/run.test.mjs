import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("text-case-converter");
import { run } from "./run.ts";

async function execute(text = "", settings = {}, secondary) {
  return run({
    input: { text, secondary, files: [] },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
}

test.each([
  ["upper", "CAFÉ HTTP SERVER 2"],
  ["lower", "café http server 2"],
  ["title", "Cafe Http Server 2"],
  ["sentence", "Cafe http server 2"],
  ["camel", "cafeHttpServer2"],
  ["pascal", "CafeHttpServer2"],
  ["snake", "cafe_http_server_2"],
  ["kebab", "cafe-http-server-2"],
  ["constant", "CAFE_HTTP_SERVER_2"],
])("text-case-converter: %s handles accents and acronyms", async (target, output) => {
  expect(await execute("café HTTP server 2", { target })).toEqual({
    render: "text",
    text: output,
  });
});

test("text-case-converter: invalid selections recover to the default and Unicode words survive", async () => {
  expect((await execute("hello_world", { target: "invalid" })).text).toBe("Hello World");
  expect((await execute("你好 мир 😀", { target: "snake" })).text).toBe("你好_мир");
});

test("text-case-converter: empty text remains empty", async () => {
  expect((await execute()).text).toBe("");
});

test.each([
  ["upper", "I LIKE ISTANBUL"],
  ["lower", "i like istanbul"],
  ["title", "I Like Istanbul"],
  ["sentence", "I like istanbul"],
  ["camel", "iLikeIstanbul"],
  ["pascal", "ILikeIstanbul"],
  ["snake", "i_like_istanbul"],
  ["kebab", "i-like-istanbul"],
  ["constant", "I_LIKE_ISTANBUL"],
])("text-case-converter: shared %s output is stable with a Turkish browser locale", async (target, output) => {
  const lower = String.prototype.toLocaleLowerCase;
  const upper = String.prototype.toLocaleUpperCase;
  const browserLower = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locale) {
    return lower.call(this, locale ?? "tr");
  });
  const browserUpper = vi.spyOn(String.prototype, "toLocaleUpperCase").mockImplementation(function (locale) {
    return upper.call(this, locale ?? "tr");
  });
  try {
    expect((await execute("I like Istanbul", { target })).text).toBe(output);
  } finally {
    browserLower.mockRestore();
    browserUpper.mockRestore();
  }
});
