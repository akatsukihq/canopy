import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("utm-builder");
import { getParameterErrors } from "./parameters.ts";
import { run } from "./run.ts";

const context = (settings = {}) => ({
  input: { text: "", files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

test("lowercase campaign values are unchanged in a Turkish browser locale", async () => {
  const lower = String.prototype.toLocaleLowerCase;
  const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (locales) {
    return lower.call(this, locales ?? "tr");
  });
  try {
    const result = await run({
      input: { text: "", files: [] },
      settings: parseSettings(definition.settings, { source: "IĞDIR", normalization: "lowercase" }),
      signal: new AbortController().signal,
    });
    expect(new URL(result.text).searchParams.get("utm_source")).toBe("iğdir");
  } finally {
    locale.mockRestore();
  }
});

test("extra UTM parameters are encoded after standard campaign values and preserve fragments", () => {
  const result = run(
    context({
      url: "https://example.com/offer#details",
      term: "search words",
      content: "hero",
      parameters: [
        { key: " ref id ", value: " A&B =?#/ 雪 " },
        { key: "utm_id", value: "sale-123" },
      ],
    }),
  );
  expect(result.text).toBe(
    "https://example.com/offer?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=search+words&utm_content=hero&ref+id=A%26B+%3D%3F%23%2F+%E9%9B%AA&utm_id=sale-123#details",
  );
});

test("extra UTM empty rows are ignored while zero-like values remain", () => {
  const parameters = [
    { key: "", value: "" },
    { key: " \t ", value: " \n " },
    { key: "count", value: "0" },
  ];
  expect(getParameterErrors(parameters)).toEqual(["", "", ""]);
  expect(run(context({ parameters })).text).toBe(
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&count=0",
  );
});

test("extra UTM incomplete pairs return row errors and fail execution", () => {
  for (const row of [
    { key: "", value: "value" },
    { key: "key", value: "" },
    { key: " \t ", value: "value" },
    { key: "key", value: " \n " },
  ]) {
    const errors = getParameterErrors([{ key: "valid", value: "yes" }, row]);
    expect(errors[0]).toBe("");
    expect(errors[1]).toMatch(/key and value/i);
    expect(() => run(context({ parameters: [row] }))).toThrow(errors[1]);
  }
});

test("extra UTM duplicate keys are rejected regardless of case or surrounding whitespace", () => {
  const parameters = [
    { key: " campaign_id ", value: "first" },
    { key: "Campaign_ID", value: "second" },
  ];
  const errors = getParameterErrors(parameters);
  expect(errors).toHaveLength(2);
  for (const error of errors) expect(error).toMatch(/already used|duplicate/i);
  expect(() => run(context({ parameters }))).toThrow(errors[0]);
});

for (const [key, label] of [
  ["utm_source", "Campaign source"],
  ["utm_medium", "Campaign medium"],
  ["utm_campaign", "Campaign name"],
  ["utm_term", "Campaign term"],
  ["utm_content", "Campaign content"],
]) {
  test(`extra UTM ${key} conflicts direct users to the existing field`, () => {
    const parameters = [{ key: ` ${key.toUpperCase()} `, value: "custom" }];
    const [error] = getParameterErrors(parameters);
    expect(error).toContain(label);
    expect(() => run(context({ parameters }))).toThrow(error);
  });
}

test("extra UTM merge replaces an existing matching key and keeps unrelated query parameters", () => {
  const result = run(
    context({
      url: "https://example.com/?ref=old&ref=duplicate&keep=yes#section",
      parameters: [{ key: "ref", value: "new" }],
    }),
  );
  const url = new URL(result.text);
  expect(url.searchParams.getAll("ref")).toEqual(["new"]);
  expect(url.searchParams.get("keep")).toBe("yes");
  expect(url.searchParams.get("utm_campaign")).toBe("launch");
  expect(url.hash).toBe("#section");
});

test("extra UTM replace removes existing query parameters without removing the fragment", () => {
  const result = run(
    context({
      url: "https://example.com/?ref=old&keep=yes#section",
      existingQuery: "replace",
      parameters: [{ key: "ref", value: "new" }],
    }),
  );
  expect(result.text).toBe(
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&ref=new#section",
  );
});

test("extra UTM normalization lowercases values while preserving key spelling", () => {
  const result = run(
    context({
      source: "Newsletter",
      normalization: "lowercase",
      parameters: [{ key: " Campaign_ID ", value: " Summer Launch " }],
    }),
  );
  const url = new URL(result.text);
  expect(url.searchParams.get("Campaign_ID")).toBe("summer launch");
  expect(url.searchParams.has("campaign_id")).toBe(false);
  expect(url.searchParams.get("utm_source")).toBe("newsletter");
});

test("extra UTM keys accept safely encoded text and ordinary object-property names", () => {
  const parameters = [
    { key: "custom key&=雪", value: "value" },
    { key: "__proto__", value: "safe" },
    { key: "constructor", value: "safe" },
  ];
  expect(getParameterErrors(parameters)).toEqual(["", "", ""]);
  const url = new URL(run(context({ parameters })).text);
  for (const row of parameters) expect(url.searchParams.get(row.key)).toBe(row.value);
});

test("extra parameter validation can localize feedback without changing which rows are invalid", () => {
  const rows = [
    { key: "missing", value: "" },
    { key: "UTM_SOURCE", value: "source" },
    { key: "id", value: "one" },
    { key: "ID", value: "two" },
    { key: "valid", value: "value" },
  ];
  const issues = [];
  const errors = getParameterErrors(rows, (issue) => {
    issues.push(issue);
    return `translated:${issue.code}`;
  });
  expect(errors).toEqual([
    "translated:missing",
    "translated:standard",
    "translated:duplicate",
    "translated:duplicate",
    "",
  ]);
  expect(issues[1]).toEqual({ code: "standard", key: "utm_source", field: "Campaign source" });
  expect(getParameterErrors(rows).map(Boolean)).toEqual(errors.map(Boolean));
});

test("legacy UTM settings without extra parameters retain their previous result", () => {
  const ctx = context();
  const { parameters, ...legacySettings } = ctx.settings;
  expect(run({ ...ctx, settings: legacySettings }).text).toBe(
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch",
  );
});
