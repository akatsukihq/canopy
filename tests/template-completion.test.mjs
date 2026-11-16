import { expect, test } from "vitest";

const { templateCompletion, applyTemplateSuggestion } =
  await import("../app/admin/(protected)/agents/lib/templateCompletion.ts");

const scope = {
  args: ["query", "count"],
  inputs: [
    { id: "apiKey", secret: true },
    { id: "baseUrl", secret: false },
  ],
  createArg: () => {},
  createInput: () => {},
};
const at = (text, scopeValue = scope) => templateCompletion(text, text.length, scopeValue);
const names = (c) => c.suggestions.map((s) => `${s.type}:${s.kind}.${s.name}`);

test("no suggestions outside a placeholder", () => {
  expect(at("https://x.test")).toBeNull();
  expect(at("{{args.query}}")).toBeNull();
  expect(at("{{inputs.baseUrl.re")).toBeNull();
});

test("an empty placeholder lists everything declared", () => {
  expect(names(at("Bearer {{"))).toEqual([
    "namespace:args.",
    "namespace:inputs.",
    "namespace:secrets.",
    "existing:args.query",
    "existing:args.count",
    "existing:inputs.baseUrl",
    "existing:secrets.apiKey",
  ]);
});

test("typing narrows by namespace and name", () => {
  expect(names(at("{{inputs."))).toEqual(["existing:inputs.baseUrl"]);
  expect(names(at("{{secrets."))).toEqual(["existing:secrets.apiKey"]);
  expect(names(at("{{args.co"))).toEqual(["existing:args.count", "create:args.co"]);
  expect(names(at("{{in"))[0]).toBe("namespace:inputs.");
  expect(names(at("{{api"))).toEqual(["existing:secrets.apiKey"]);
});

test("an unknown name offers to create it", () => {
  expect(names(at("{{args.limit"))).toEqual(["create:args.limit"]);
  expect(names(at("{{inputs.region"))).toEqual(["create:inputs.region"]);
  expect(names(at("{{secrets.token"))).toEqual(["create:secrets.token"]);
  expect(at("{{region")).toBeNull();
  expect(names(at("{{secrets"))).toEqual(["namespace:secrets.", "existing:secrets.apiKey"]);
  expect(names(at("{{args.query"))).toEqual(["existing:args.query"]);
});

test("create is hidden when the scope cannot grow", () => {
  expect(at("{{args.limit", { ...scope, createArg: undefined, createInput: undefined })).toBeNull();
});

test("choosing inserts the name and closes the braces once", () => {
  const open = at("q={{args.qu");
  expect(applyTemplateSuggestion("q={{args.qu", open, open.suggestions[0])).toEqual({
    value: "q={{args.query}}",
    caret: "q={{args.query}}".length,
  });
  const text = "q={{args.qu}}&n=1";
  const inside = templateCompletion(text, "q={{args.qu".length, scope);
  expect(applyTemplateSuggestion(text, inside, inside.suggestions[0])).toEqual({
    value: "q={{args.query}}&n=1",
    caret: "q={{args.query}}".length,
  });
});
