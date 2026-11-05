import { toolSpec } from "./helpers/toolSpec.mjs";
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { decodeToolShare, encodeToolShare, MAX_SHARE_URL_LENGTH } from "../lib/tool-framework/toolShare.ts";

const spec = {
  toolId: "devtools.share-fixture",
  sharing: { version: 1 },
  input: { kind: "text", required: false, secondary: { label: "Second input" } },
  settings: {
    fields: {
      label: { kind: "text", label: "Label", default: "Default", maxLength: 30 },
      count: { kind: "number", label: "Count", default: 2, min: 0, max: 10, step: 1 },
      enabled: { kind: "toggle", label: "Enabled", default: true },
      format: {
        kind: "select",
        label: "Format",
        default: "first",
        choices: [{ value: "first" }, { value: "second" }],
      },
    },
  },
};
const defaults = Object.fromEntries(Object.entries(spec.settings.fields).map(([key, field]) => [key, field.default]));
const state = { input: { text: "input", secondary: "second" }, settings: defaults };
const payload = (overrides = {}) => ({ v: 1, tool: spec.toolId, revision: 1, ...state, ...overrides });
const hash = (value) => `#share=${encodeURIComponent(JSON.stringify(value))}`;
const expectInvalid = (result) => expect(result).toEqual({ error: expect.any(String) });

test("Unicode, newlines, reserved characters and both input channels round-trip exactly", () => {
  const original = {
    input: { text: "Café / नमस्ते 🦋\n?x=1&hash=# 💡\r\n\u0000", secondary: 'quotes " and %20 + =' },
    settings: { label: "", count: 0, enabled: false, format: "second" },
  };
  const encoded = encodeToolShare(spec, original);
  expect(encoded.hash).toMatch(/^#share=/);
  expect(decodeToolShare(spec, encoded.hash)).toEqual({ state: original });
  expect(JSON.parse(decodeURIComponent(encoded.hash.slice(7)))).toEqual({
    v: 1,
    tool: spec.toolId,
    revision: 1,
    ...original,
  });
});

test("all effective defaults are present and survive changes to application defaults", () => {
  const encoded = encodeToolShare(spec, state);
  const changedDefaults = {
    ...spec,
    settings: { fields: { ...spec.settings.fields, enabled: { ...spec.settings.fields.enabled, default: false } } },
  };
  expect(decodeToolShare(changedDefaults, encoded.hash)).toEqual({ state });
});

test("optional empty text and secondary input remain empty", () => {
  const original = { ...state, input: { text: "", secondary: "" } };
  expect(decodeToolShare(spec, encodeToolShare(spec, original).hash)).toEqual({ state: original });
});

test.each(["", "#", "#usage", "#share-help", "#something=else"])("unrelated fragment %s is ignored", (fragment) => {
  expect(decodeToolShare(spec, fragment)).toBeNull();
});

test.each(["#share=", "#share=%", "#share=%E0%A4%A", "#share=not-json", hash(null), hash([]), hash(3)])(
  "malformed share fragment %s is rejected",
  (fragment) => expectInvalid(decodeToolShare(spec, fragment)),
);

test.each([
  { v: 2 },
  { v: "1" },
  { revision: 2 },
  { revision: "1" },
  { tool: "devtools.some-other-tool" },
  { tool: undefined },
  { unknown: true },
  { input: undefined },
  { settings: undefined },
])("incompatible or incomplete envelope is rejected: %j", (overrides) => {
  expectInvalid(decodeToolShare(spec, hash(payload(overrides))));
});

test.each([
  {},
  { ...defaults, label: 3 },
  { ...defaults, label: "x".repeat(31) },
  { ...defaults, count: "0" },
  { ...defaults, count: -1 },
  { ...defaults, count: 11 },
  { ...defaults, count: 0.5 },
  { ...defaults, count: null },
  { ...defaults, enabled: "false" },
  { ...defaults, format: "third" },
  { ...defaults, unknown: "ignored?" },
  null,
  [],
])("invalid settings are rejected without coercion, truncation or defaults: %j", (settings) => {
  expectInvalid(encodeToolShare(spec, { ...state, settings }));
  expectInvalid(decodeToolShare(spec, hash(payload({ settings }))));
});

test.each([Number.NaN, Infinity, -Infinity])("non-finite number %s cannot be encoded", (count) => {
  expectInvalid(encodeToolShare(spec, { ...state, settings: { ...defaults, count } }));
});

test("undeclared, secret and file input channels cannot be shared", () => {
  for (const input of [
    { kind: "files", label: "Upload" },
    { kind: "fields", fields: [{ channel: "text", secret: true }] },
    { kind: "fields", fields: [{ channel: "secondary", secret: true }] },
  ]) {
    const unsafeSpec = { ...spec, input };
    expectInvalid(encodeToolShare(unsafeSpec, state));
    expectInvalid(decodeToolShare(unsafeSpec, hash(payload())));
  }
  for (const input of [
    { text: 4 },
    { secondary: "missing primary" },
    { text: "input", secondary: null },
    { text: "input", files: [] },
    { text: "input", unknown: true },
  ]) {
    expectInvalid(encodeToolShare(spec, { ...state, input }));
    expectInvalid(decodeToolShare(spec, hash(payload({ input }))));
  }
  const primaryOnly = { ...spec, input: { kind: "fields", fields: [{ channel: "text" }] } };
  expectInvalid(encodeToolShare(primaryOnly, state));
  expectInvalid(decodeToolShare(primaryOnly, hash(payload())));
});

test("declared input length limits apply to text and field channels", () => {
  for (const input of [
    { kind: "text", maxLength: 2, secondary: { label: "Second" } },
    { kind: "fields", fields: [{ channel: "text", maxLength: 2 }, { channel: "secondary" }] },
    { kind: "fields", fields: [{ channel: "text" }, { channel: "secondary", maxLength: 2 }] },
  ]) {
    expectInvalid(encodeToolShare({ ...spec, input }, state));
    expectInvalid(decodeToolShare({ ...spec, input }, hash(payload())));
  }
});

test("required input channels must have a nonempty value", () => {
  for (const input of [
    { kind: "text" },
    { kind: "fields", fields: [{ channel: "text", required: true }] },
    { kind: "fields", fields: [{ channel: "secondary", required: true }] },
  ]) {
    const empty = { ...state, input: { text: "" } };
    expectInvalid(encodeToolShare({ ...spec, input }, empty));
    expectInvalid(decodeToolShare({ ...spec, input }, hash(payload(empty))));
  }
});

test("settings-only tools accept only empty primary input", () => {
  const settingsOnly = { ...spec, input: { kind: "none" } };
  const empty = { ...state, input: { text: "" } };
  expect(decodeToolShare(settingsOnly, encodeToolShare(settingsOnly, empty).hash)).toEqual({ state: empty });
  expectInvalid(encodeToolShare(settingsOnly, { ...empty, input: { text: "hidden value" } }));
});

test("multiline settings, colors and ordered duplicate query rows round-trip exactly", () => {
  const fields = {
    lines: { kind: "textarea", default: "" },
    color: { kind: "color", default: "#fff" },
    background: { kind: "color", default: "transparent", allowTransparent: true },
    params: { kind: "rows", default: [] },
  };
  const expanded = { ...spec, settings: { fields } };
  const original = {
    ...state,
    settings: {
      lines: 'first\n"second" ✓',
      color: "#AbC8",
      background: "transparent",
      params: [
        { key: "tag", value: "a & b" },
        { key: "tag", value: "✓" },
        { key: "", value: "" },
      ],
    },
  };
  expect(decodeToolShare(expanded, encodeToolShare(expanded, original).hash)).toEqual({ state: original });
  expect(
    decodeToolShare(
      expanded,
      encodeToolShare(expanded, { ...original, settings: { ...original.settings, params: [] } }).hash,
    ),
  ).toEqual({ state: { ...original, settings: { ...original.settings, params: [] } } });
});

test.each(["red", "rgb(241 245 249 / 0.5)", "hsl(210 50% 40%)", " #AbC "])(
  "color controls preserve %s exactly",
  (color) => {
    const expanded = { ...spec, settings: { fields: { color: { kind: "color", default: "#fff" } } } };
    const original = { ...state, settings: { color } };
    const encoded = encodeToolShare(expanded, original);
    expect(encoded).toHaveProperty("hash");
    expect(decodeToolShare(expanded, encoded.hash)).toEqual({ state: original });
  },
);

test.each([
  ["textarea", 3],
  ["textarea", "x".repeat(MAX_SHARE_URL_LENGTH + 1)],
  ["color", "url(https://example.com)"],
  ["color", "#12"],
  ["color", "rgb(256 0 0)"],
  ["color", "transparent"],
  ["rows", {}],
  ["rows", [null]],
  ["rows", [{ key: "a" }]],
  ["rows", [{ key: "a", value: 1 }]],
  ["rows", [{ key: "a", value: "b", hidden: true }]],
])("invalid %s setting is rejected without dropping data: %j", (kind, value) => {
  const expanded = { ...spec, settings: { fields: { value: { kind, default: "" } } } };
  const invalid = { ...state, settings: { value } };
  expectInvalid(encodeToolShare(expanded, invalid));
  expectInvalid(decodeToolShare(expanded, hash(payload(invalid))));
});

test("rows reject sparse arrays, hidden properties, inherited values and accessors", () => {
  const expanded = { ...spec, settings: { fields: { params: { kind: "rows", default: [] } } } };
  const getter = Object.defineProperty({}, "key", {
    enumerable: true,
    get() {
      throw new Error("must not read");
    },
  });
  for (const params of [
    new Array(1),
    Object.assign([], { hidden: "value" }),
    [Object.create({ key: "a", value: "b" })],
    [getter],
    Object.defineProperty([], "0", {
      enumerable: true,
      get() {
        throw new Error("must not read");
      },
    }),
    [JSON.parse('{"key":"a","value":"b","__proto__":{}}')],
  ])
    expectInvalid(encodeToolShare(expanded, { ...state, settings: { params } }));
});

test.each(["password", "slider", "preset", "date", "position", "pages"])(
  "unsupported %s settings disable sharing even when the value is empty",
  (kind) => {
    const unsafeSpec = { ...spec, settings: { fields: { unsafe: { kind, default: "" } } } };
    const unsafeState = { ...state, settings: { unsafe: "" } };
    expectInvalid(encodeToolShare(unsafeSpec, unsafeState));
    expectInvalid(decodeToolShare(unsafeSpec, hash(payload(unsafeState))));
  },
);

test("tools must explicitly opt in with a positive integer compatibility revision", () => {
  for (const sharing of [undefined, { version: 0 }, { version: -1 }, { version: 1.5 }]) {
    expectInvalid(encodeToolShare({ ...spec, sharing }, state));
    expectInvalid(decodeToolShare({ ...spec, sharing }, hash(payload())));
  }
});

test("oversized raw and encoded data are rejected without truncation", () => {
  for (const text of ["x".repeat(MAX_SHARE_URL_LENGTH), "界".repeat(500)]) {
    expectInvalid(encodeToolShare(spec, { ...state, input: { text } }));
    expectInvalid(decodeToolShare(spec, hash(payload({ input: { text } }))));
  }
});

test("hostile prototypes and reserved object keys cannot enter restored state", () => {
  const inherited = Object.create(defaults);
  expectInvalid(encodeToolShare(spec, { ...state, settings: inherited }));
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const badSettings = JSON.parse(`{"${key}":"poison"}`);
    const unsafeSpec = { ...spec, settings: { fields: Object.fromEntries([[key, { kind: "text", default: "" }]]) } };
    expectInvalid(encodeToolShare(unsafeSpec, { ...state, settings: badSettings }));
    expectInvalid(decodeToolShare(unsafeSpec, hash(payload({ settings: badSettings }))));
  }
  expect({}.poison).toBeUndefined();
});

test("validation does not mutate source state or definitions", () => {
  const original = structuredClone(state);
  const definition = structuredClone(spec);
  const encoded = encodeToolShare(spec, state);
  decodeToolShare(spec, encoded.hash);
  expect(state).toEqual(original);
  expect(spec).toEqual(definition);
});

describe("supported tools recreate the exact output", () => {
  test.each([
    ["hex-to-rgb", "#3366ff80\n#f90", { includeAlpha: false, commaSyntax: false, outputFormat: "channels" }],
    ["contrast-checker", "", { foreground: "#000000", background: "#ffffff" }],
    ["css-unit-converter", "32px\n2em", { to: "rem", base: 20, includeFormula: true, precision: 0 }],
    ["cron-parser", "0 9 * * 1-5", {}],
    ["slug-generator", "Café Menu 2026\nHello & goodbye", {}],
    ["text-case-converter", "hello Smart tools", { target: "snake" }],
  ])("%s preserves settings and calculated output", async (key, text, overrides) => {
    const definition = await toolSpec(key);
    const run = (await import(`../tools/${key}/run.ts`)).default;
    const settings = Object.fromEntries(
      Object.entries(definition.settings.fields).map(([name, field]) => [name, field.default]),
    );
    const original = { input: { text }, settings: { ...settings, ...overrides } };
    const encoded = encodeToolShare(definition, original);
    expect(encoded).toHaveProperty("hash");
    const restored = decodeToolShare(definition, encoded.hash);
    expect(restored).toEqual({ state: original });
    const context = (data) => ({
      ...data,
      input: { ...data.input, files: [] },
      signal: new AbortController().signal,
      progress: () => {},
      writeArtifact: () => {
        throw new Error("Shareable tool unexpectedly wrote an artifact");
      },
    });
    expect(await run(context(restored.state))).toEqual(await run(context(original)));
  });
});

// Each opt-in is exercised through its actual runner, including worker entries.
const expandedTools = `
base64-encoder base64-decoder binary-to-text text-to-binary hex-to-text text-to-hex
unicode-encoder unicode-decoder url-encoder url-decoder html-encoder html-decoder
md5-generator sha1-generator sha256-generator sha512-generator checksum-generator
character-counter word-counter text-reverser whitespace-remover duplicate-line-remover
duplicate-word-remover text-sorter text-diff-checker cron-builder url-query-parser
url-query-builder utm-builder http-status-codes json-escape json-unescape json-validator
json-formatter json-minifier json-key-extractor json-to-yaml json-to-xml xml-to-json
json-to-csv json-to-typescript json-schema-generator csv-column-extractor
csv-delimiter-converter csv-to-tsv tsv-to-csv rgb-to-hex hex-to-hsl color-converter
border-radius-generator css-box-shadow gradient-generator palette-generator
meta-tag-generator robots-txt-generator sitemap-generator qr-code-generator
`
  .trim()
  .split(/\s+/);

async function expectOutputRoundTrip(key, exampleOverride) {
  const definition = await toolSpec(key);
  const file = existsSync(new URL(`../tools/${key}/run.ts`, import.meta.url)) ? "run.ts" : "run.worker.ts";
  const run = (await import(/* @vite-ignore */ `../tools/${key}/${file}`)).default;
  const example = exampleOverride ?? definition.content?.examples?.[0] ?? { text: "" };
  const settings = Object.fromEntries(
    Object.entries(definition.settings.fields).map(([name, field]) => [name, field.default]),
  );
  const original = {
    input: { text: example.text, ...(example.secondary !== undefined ? { secondary: example.secondary } : {}) },
    settings: { ...settings, ...example.settings },
  };
  const encoded = encodeToolShare(definition, original);
  expect(encoded).toHaveProperty("hash");
  const restored = decodeToolShare(definition, encoded.hash);
  expect(restored).toEqual({ state: original });
  const context = (data) => ({
    ...data,
    input: { ...data.input, files: [] },
    signal: new AbortController().signal,
    progress: () => {},
    writeArtifact: () => {
      throw new Error("Small example unexpectedly wrote a stored artifact");
    },
  });
  expect(await run(context(restored.state))).toEqual(await run(context(original)));
}

test.each(expandedTools)("%s example restores the same output", async (key) => {
  await expectOutputRoundTrip(key);
});

test("shadow preview supports the transparent color accepted by its controls", async () => {
  await expectOutputRoundTrip("css-box-shadow", {
    text: "#00000080",
    settings: { previewBackground: "transparent", previewObject: "transparent" },
  });
});

test.each([
  [
    "url-query-builder",
    {
      text: "https://example.com/path?z=1#section",
      secondary: "tag=one\ntag=two",
      settings: {
        parameters: [
          { key: "q", value: "space & ✓" },
          { key: "empty", value: "" },
        ],
        sortParameters: true,
      },
    },
  ],
  [
    "gradient-generator",
    {
      text: "#fff",
      secondary: "#000",
      settings: {
        type: "radial",
        radialShape: "ellipse",
        radialX: 25,
        radialY: 75,
        includeFallback: true,
        stops: JSON.stringify([
          { id: "a", color: "#F00", position: 0 },
          { id: "b", color: "#00F8", position: 40 },
          { id: "c", color: "#0000", position: 100 },
        ]),
      },
    },
  ],
  [
    "css-box-shadow",
    {
      text: "#00000080",
      settings: {
        previewBackground: "rgb(241 245 249 / 0.5)",
        previewObject: "rebeccapurple",
        showBrowserPrefixes: true,
        layers: JSON.stringify([
          { id: "a", color: "#00000080", x: -6, y: 8, blur: 20, spread: -4, inset: true, enabled: true },
          { id: "b", color: "#f00", x: 0, y: 2, blur: 4, spread: 0, inset: false, enabled: false },
        ]),
      },
    },
  ],
  [
    "palette-generator",
    {
      text: "",
      settings: {
        count: 3,
        variation: 3,
        format: "svg",
        colors: JSON.stringify([
          { id: "a", color: "#FF0000", locked: true },
          { id: "b", color: "#00FF00", locked: false },
          { id: "c", color: "#0000FF", locked: true },
        ]),
      },
    },
  ],
  [
    "border-radius-generator",
    {
      text: "",
      settings: {
        elliptical: true,
        linked: false,
        topLeft: 35,
        topRight: 70,
        topLeftY: 20,
        unit: "%",
        width: 300,
        height: 180,
      },
    },
  ],
  [
    "robots-txt-generator",
    {
      text: "/private\n/admin",
      settings: { allowPaths: "/public\n/docs", crawlDelay: 10, sitemap: "https://example.com/sitemap.xml" },
    },
  ],
  [
    "qr-code-generator",
    {
      text: "https://example.com/?q=✓",
      settings: {
        dark: "#123456",
        light: "#fedcba",
        size: 256,
        margin: 2,
        transparentBackground: true,
        errorCorrection: "H",
      },
    },
  ],
  [
    "json-formatter",
    { text: '{"nested":[false,null],"n":1234567890123456789}', settings: { operation: "format", indentation: "tab" } },
  ],
  ["json-formatter", { text: '{ "nested": [false,null] }', settings: { operation: "minify" } }],
  ["json-formatter", { text: '{ "nested": [false,null] }', settings: { operation: "validate" } }],
])("%s complex settings and output round-trip", async (key, example) => {
  await expectOutputRoundTrip(key, example);
});
