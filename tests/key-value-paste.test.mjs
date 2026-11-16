import { expect, test } from "vitest";

const { parseKeyValuePaste, pairsFromPaste, insertPairs } = await import("../utils/keyValuePaste.ts");

test("quoted JSON-style lines become one pair each, keeping template values", () => {
  const text = `    "engine": "{{args.engine}}",
    "q": "{{args.query}}",
    "api_key": "{{inputs.apiKey}}"`;
  expect(parseKeyValuePaste(text)).toEqual([
    { key: "engine", value: "{{args.engine}}" },
    { key: "q", value: "{{args.query}}" },
    { key: "api_key", value: "{{inputs.apiKey}}" },
  ]);
});

test("accepts headers, env style, whole objects and URL values", () => {
  expect(parseKeyValuePaste("Authorization: Bearer abc\nAccept: application/json")).toEqual([
    { key: "Authorization", value: "Bearer abc" },
    { key: "Accept", value: "application/json" },
  ]);
  expect(parseKeyValuePaste("# note\nA=1\nB=two")).toEqual([
    { key: "A", value: "1" },
    { key: "B", value: "two" },
  ]);
  expect(parseKeyValuePaste('{ "a": "x", "n": 2 }')).toEqual([
    { key: "a", value: "x" },
    { key: "n", value: "2" },
  ]);
  expect(parseKeyValuePaste('"url": "https://x.test/a?b=c"')).toEqual([{ key: "url", value: "https://x.test/a?b=c" }]);
});

test("text that is not pairs is left to the normal paste", () => {
  expect(parseKeyValuePaste("just some words")).toBeNull();
  expect(parseKeyValuePaste("ok: 1\nnot a pair")).toBeNull();
  expect(pairsFromPaste("https://example.com/a", "value")).toBeNull();
  expect(pairsFromPaste("a: 1", "value")).toBeNull();
  expect(pairsFromPaste("a: 1", "key")).toEqual([{ key: "a", value: "1" }]);
});

test("pasted pairs fill an empty row or are inserted after a filled one", () => {
  const make = (pair) => pair;
  const pasted = [
    { key: "a", value: "1" },
    { key: "b", value: "2" },
  ];
  const rows = [
    { key: "x", value: "y" },
    { key: "", value: "" },
    { key: "z", value: "w" },
  ];
  expect(insertPairs(rows, 1, pasted, make).map((r) => r.key)).toEqual(["x", "a", "b", "z"]);
  expect(insertPairs(rows, 0, pasted, make).map((r) => r.key)).toEqual(["x", "a", "b", "", "z"]);
});
