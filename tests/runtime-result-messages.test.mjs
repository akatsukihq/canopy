import { toolSpec } from "./helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { context, execute } from "./helpers/json-tools.mjs";
import { hslToRgb, parseColor } from "../lib/devtools/shared/color.ts";
import { ToolError } from "../lib/tool-framework/run.ts";
import { parseSettings } from "../lib/tool-framework/settings.ts";
import { translateToolResult } from "../lib/tool-framework/result.ts";
import { extractToolMessages, toolMessageTree, validateToolTranslation } from "../lib/tool-framework/translations.ts";
import { run as color } from "../tools/color-converter/run.ts";
const colorDefinition = await toolSpec("color-converter");
import { run as css } from "../tools/css-unit-converter/run.ts";
const cssDefinition = await toolSpec("css-unit-converter");
import { run as dns } from "../tools/dns-checker/run.ts";
const dnsDefinition = await toolSpec("dns-checker");
import { run as schema } from "../tools/json-schema-validator/run.ts";
const schemaDefinition = await toolSpec("json-schema-validator");
import { run as contrast } from "../tools/contrast-checker/run.ts";
const contrastDefinition = await toolSpec("contrast-checker");
import { run as axios } from "../tools/curl-to-axios/run.ts";
const axiosDefinition = await toolSpec("curl-to-axios");
import { run as formatter } from "../tools/json-formatter/run.worker.ts";
const formatterDefinition = await toolSpec("json-formatter");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function translator(definition, locale = "en", overrides = {}) {
  const english = extractToolMessages(definition);
  expect(validateToolTranslation(locale, overrides, english, { publish: false })).toEqual([]);
  const translate = createTranslator({
    locale,
    namespace: "runtime",
    messages: toolMessageTree({ ...english, ...overrides }),
    onError(error) {
      throw error;
    },
  });
  return (message) => {
    expect(message).toBeDefined();
    expect(Object.hasOwn(english, `runtime.${message.key}`)).toBe(true);
    return translate(message.key, message.values);
  };
}

async function failure(operation) {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error;
  }
  throw new Error("Expected execution to reject the input");
}

test.each([
  ["var(--brand)", "syntax", "color.syntax"],
  ["rgb(1, 2)", "syntax", "color.commaChannels"],
  ["rgb(1 2)", "syntax", "color.spaceChannels"],
  ["rgb(1%, 2, 3)", "syntax", "color.consistentChannels"],
  ["hsl(10 20 30)", "syntax", "color.hslSuffix"],
  ["rgb(nope 0 0)", "syntax", "color.finiteChannel"],
  ["rgb(256 0 0)", "range", "color.channelRange"],
  ["rgb(0 0 0 / 2)", "range", "color.channelRange"],
  ["#12", "invalid-hex-color", "color.hexFormat"],
])("color error %s retains its stable code and branch-specific message", async (input, code, key) => {
  const error = await failure(() => parseColor(input));
  expect(error.code).toBe(code);
  expect(error.details.messageRef.key).toBe(key);
  const translate = translator(colorDefinition);
  expect(translate(error.details.messageRef)).toBe(error.message);
  if (error.recovery) expect(translate(error.details.recoveryMessage)).toBe(error.recovery);
});

test("color range errors distinguish non-finite hue from numeric bounds using native ICU select values", async () => {
  const hue = await failure(() => hslToRgb(Infinity, 50, 50));
  const channel = await failure(() => parseColor("rgb(256 0 0)"));
  expect(hue.code).toBe("range");
  expect(channel.code).toBe("range");
  expect(hue.details.messageRef).toEqual({ key: "color.finiteHue" });
  expect(channel.details.messageRef).toEqual({
    key: "color.channelRange",
    values: { channel: "rgbChannel", min: 0, max: 255 },
  });
  const translate = translator(colorDefinition, "fr", {
    "runtime.color.finiteHue": "La teinte doit être un nombre fini.",
    "runtime.color.channelRange":
      "{channel, select, alpha {Alpha} rgbPercentage {Pourcentage RVB} rgbChannel {Canal RVB} hue {Teinte} hslPercentage {Pourcentage TSL} saturation {Saturation} lightness {Luminosité} other {Canal de couleur}} : {min}–{max}.",
  });
  expect(translate(hue.details.messageRef)).toBe("La teinte doit être un nombre fini.");
  expect(translate(channel.details.messageRef)).toBe("Canal RVB : 0–255.");
});

test("batch color conversion preserves issue references, source lines and exact converted colors", async () => {
  const result = await execute(color, "#ff0000\nrgb(256 0 0)\nvar(--brand)\n#00ff00", { outputFormat: "rgb" });
  expect(result.items).toEqual(["rgb(255 0 0)", "rgb(0 255 0)"]);
  expect(result.labels).toEqual(["#ff0000", "#00ff00"]);
  expect(result.issues.map(({ line, messageRef }) => ({ line, messageRef }))).toEqual([
    { line: 2, messageRef: { key: "color.channelRange", values: { channel: "rgbChannel", min: 0, max: 255 } } },
    { line: 3, messageRef: { key: "color.syntax" } },
  ]);
  const english = translator(colorDefinition);
  for (const issue of result.issues) expect(english(issue.messageRef)).toBe(issue.message);
  const displayed = translateToolResult(
    result,
    translator(colorDefinition, "fr", {
      "runtime.color.syntax": "Saisissez une couleur HEX, RVB, TSL ou nommée.",
    }),
  );
  expect(displayed.issues[1].message).toBe("Saisissez une couleur HEX, RVB, TSL ou nommée.");
  expect(displayed.issues.map(({ line }) => line)).toEqual([2, 3]);
  expect(displayed.items).toEqual(result.items);
  expect(displayed.labels).toEqual(result.labels);
});

test("batch CSS conversion retains distinct invalid-value errors, coordinates and raw table cells", async () => {
  const settings = parseSettings(cssDefinition.settings, { from: "px", to: "rem", base: 16, includeFormula: false });
  const result = await execute(css, "16px\nwat\n1e999px", settings);
  const translate = translator(cssDefinition, "fr", {
    "runtime.css.numberRequired": "Saisissez un nombre avec une unité CSS facultative.",
    "runtime.css.finiteNumber": "Saisissez un nombre fini.",
    "runtime.css.converted": "{converted, number} conversion · {corrections, number} corrections",
    "runtime.css.columns.line": "Ligne",
    "runtime.css.columns.input": "Entrée",
    "runtime.css.columns.result": "Résultat",
  });
  expect(result.rows).toEqual([
    ["1", "16px", "1rem"],
    ["2", "wat", ""],
    ["3", "1e999px", ""],
  ]);
  expect(result.issues.map(({ line, messageRef }) => ({ line, messageRef }))).toEqual([
    { line: 2, messageRef: { key: "css.numberRequired" } },
    { line: 3, messageRef: { key: "css.finiteNumber" } },
  ]);
  for (const [index, input] of ["wat", "1e999px"].entries()) {
    const error = await failure(() => execute(css, input, settings));
    expect(error.code).toBe("invalid-value");
    expect(error.details.messageRef).toEqual(result.issues[index].messageRef);
  }
  expect(result.columnMessages.map(translate)).toEqual(["Ligne", "Entrée", "Résultat"]);
  const displayed = translateToolResult(result, translate);
  expect(displayed.issues.map(({ message }) => message)).toEqual([
    "Saisissez un nombre avec une unité CSS facultative.",
    "Saisissez un nombre fini.",
  ]);
  expect(displayed.verdict.label).toBe("1 conversion · 2 corrections");
  expect(displayed.rows).toEqual(result.rows);
  expect(displayed.columns).toEqual(["Line", "Input", "Result"]);
});

function mockDns(data) {
  const fetch = vi.fn(async (url) => {
    expect(new URL(url).hostname).toBe("dns.google");
    return new Response(JSON.stringify(data), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const dnsSettings = parseSettings(dnsDefinition.settings, { types: "TXT", recordView: "raw", includeTtl: true });
const dnsAnswer = (data = '"v=spf1 {source}<tag>"') => ({ name: "example.com.", type: 16, TTL: 300, data });

test.each([1, 2])(
  "DNS verdict and detail interpolate %i answers without rewriting raw resolver data",
  async (count) => {
    const data = {
      Status: 0,
      Answer: Array.from({ length: count }, (_, index) => dnsAnswer(`"authored {value}<${index}>"`)),
    };
    const fetch = mockDns(data);
    const result = await execute(dns, "example.com", dnsSettings);
    const translate = translator(dnsDefinition, "fr", {
      "runtime.dns.status.returned": "Enregistrements reçus",
      "runtime.dns.details.returned": "{count, plural, one {# réponse reçue} other {# réponses reçues}}.",
      "runtime.dns.verdict.found":
        "{count, plural, one {# enregistrement trouvé} other {# enregistrements trouvés}} pour {domain}",
      "runtime.dns.verdict.foundDetail": "Types interrogés : {types}.",
    });
    const status = result.sections[0].body;
    expect(status.rows[0][1]).toBe("Records returned");
    expect(status.rowMessages[0][2]).toEqual({ key: "dns.details.returned", values: { count } });
    expect(translate(status.rowMessages[0][1])).toBe("Enregistrements reçus");
    expect(translate(status.rowMessages[0][2])).toBe(count === 1 ? "1 réponse reçue." : "2 réponses reçues.");
    expect(result.verdict.labelMessage).toEqual({ key: "dns.verdict.found", values: { count, domain: "example.com" } });
    const displayed = translateToolResult(result, translate);
    expect(displayed.verdict.label).toBe(
      count === 1 ? "1 enregistrement trouvé pour example.com" : "2 enregistrements trouvés pour example.com",
    );
    expect(displayed.verdict.detail).toBe("Types interrogés : TXT.");
    expect(displayed.text).toBe(JSON.stringify({ TXT: data }, null, 2));
    expect(displayed.tablePreview.rows).toEqual(data.Answer.map((answer) => ["TXT", answer.name, answer.data, "300"]));
    expect(displayed.sections[0].body.rows).toEqual(status.rows);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("DNS counts distinguish resolver answers from deduplicated records", async () => {
  const data = { Status: 0, Answer: [dnsAnswer(), dnsAnswer()] };
  mockDns(data);
  const result = await execute(dns, "example.com", dnsSettings);
  expect(result.sections[0].body.rowMessages[0][2]).toEqual({ key: "dns.details.returned", values: { count: 2 } });
  expect(result.verdict.labelMessage).toEqual({
    key: "dns.verdict.found",
    values: { count: 1, domain: "example.com" },
  });
  expect(result.tablePreview.rows).toHaveLength(1);
  expect(result.text).toBe(JSON.stringify({ TXT: data }, null, 2));
});

test.each([
  [{ Status: 3 }, "Domain not found", "notFound", "notFound", undefined, "notFound"],
  [{ Status: 2 }, "Resolver failed", "failed", "failed", { status: 2 }, "failed"],
  [{ Status: 5 }, "Resolver failed", "failed", "failed", { status: 5 }, "failed"],
  [{ Status: 9 }, "Resolver failed", "failed", "failed", { status: 9 }, "failed"],
  [{ Status: "invalid" }, "Invalid response", "invalid", "invalid", undefined, "failed"],
  [
    { Status: 0, TC: true, Answer: [dnsAnswer(), dnsAnswer("second")] },
    "Incomplete response",
    "incomplete",
    "truncated",
    { count: 2 },
    "warning",
  ],
  [{ Status: 0, Answer: [dnsAnswer(), null] }, "Incomplete response", "incomplete", "skipped", { count: 1 }, "warning"],
  [{ Status: 0, Answer: [] }, "No records", "none", "none", { type: "TXT" }, "none"],
])(
  "DNS response %j preserves canonical status and resolves its specific detail",
  async (data, status, statusKey, detailKey, values, verdictKey) => {
    mockDns(data);
    const result = await execute(dns, "example.com", dnsSettings);
    const body = result.sections[0].body;
    expect(body.rows[0][1]).toBe(status);
    expect(body.rowMessages[0][1]).toEqual({ key: `dns.status.${statusKey}` });
    expect(body.rowMessages[0][2]).toEqual({ key: `dns.details.${detailKey}`, values });
    expect(result.verdict.labelMessage).toEqual({
      key: `dns.verdict.${verdictKey}`,
      values: { domain: "example.com" },
    });
    const english = translator(dnsDefinition);
    expect(english(body.rowMessages[0][1])).toBe(status);
    expect(english(body.rowMessages[0][2])).toBe(body.rows[0][2]);
    expect(english(result.verdict.labelMessage)).toBe(result.verdict.label);
    expect(english(result.verdict.detailMessage)).toBe(result.verdict.detail);
    expect(result.text).toBe(JSON.stringify({ TXT: data }, null, 2));
  },
);

test("DNS warning details use native ICU numbers and select without changing DNS status codes", async () => {
  mockDns({ Status: 5 });
  const result = await execute(dns, "example.com", dnsSettings);
  const translate = translator(dnsDefinition, "fr", {
    "runtime.dns.details.failed":
      "Le résolveur {status, select, 2 {a échoué} 5 {a refusé la requête} other {a signalé une erreur}} (statut {status}).",
    "runtime.dns.verdict.warningDetail":
      "{count, plural, one {# enregistrement reçu} other {# enregistrements reçus}}.",
  });
  expect(translate(result.sections[0].body.rowMessages[0][2])).toBe("Le résolveur a refusé la requête (statut 5).");
  expect(result.verdict.detailMessage).toEqual({ key: "dns.verdict.warningDetail", values: { count: 0 } });
  expect(translate(result.verdict.detailMessage)).toBe("0 enregistrement reçu.");
  expect(JSON.parse(result.text)).toEqual({ TXT: { Status: 5 } });
});

test("schema issues translate native placeholders while preserving authored paths and raw validation report", async () => {
  const data = { users: [{ "name{raw}<x>": "A", age: "young" }] };
  const rules = {
    type: "object",
    properties: {
      users: {
        type: "array",
        items: {
          type: "object",
          required: ["id"],
          properties: { "name{raw}<x>": { minLength: 3 }, age: { type: "number" } },
        },
      },
    },
  };
  const result = await execute(schema, JSON.stringify(data), {}, JSON.stringify(rules));
  expect(result.issues.map(({ target, messageRef }) => ({ target, messageRef }))).toEqual([
    { target: "input", messageRef: { key: "schema.required", values: { path: "$.users[0].id" } } },
    {
      target: "input",
      messageRef: { key: "schema.minimumLength", values: { path: "$.users[0].name{raw}<x>", count: 3 } },
    },
    {
      target: "input",
      messageRef: {
        key: "schema.typeMismatch",
        values: { path: "$.users[0].age", expected: "number", actual: "string" },
      },
    },
  ]);
  const translate = translator(schemaDefinition, "fr", {
    "runtime.schema.required": "{path} : requis",
    "runtime.schema.minimumLength": "{path} : au moins {count, number} caractères",
    "runtime.schema.typeMismatch": "{path} : attendu {expected}, reçu {actual}",
    "runtime.schema.invalid": "Invalide",
    "runtime.schema.problemCount": "{count, plural, one {# problème} other {# problèmes}}",
  });
  const displayed = translateToolResult(result, translate);
  expect(displayed.issues.map(({ message }) => message)).toEqual([
    "$.users[0].id : requis",
    "$.users[0].name{raw}<x> : au moins 3 caractères",
    "$.users[0].age : attendu number, reçu string",
  ]);
  expect(displayed.verdict.label).toBe("Invalide");
  expect(displayed.verdict.detail).toBe("3 problèmes");
  expect(displayed.text).toBe(
    "Invalid\n- $.users[0].id: is required\n- $.users[0].name{raw}<x>: must contain at least 3 characters\n- $.users[0].age: expected number, received string",
  );
  expect(result.issues[0].message).toBe("$.users[0].id: is required");
});

test.each([
  ["a", false, "objectRequired", { path: "$" }],
  ["a", { enum: ["b"] }, "enumMismatch", { path: "$" }],
  ["abcd", { maxLength: 3 }, "maximumLength", { path: "$", count: 3 }],
  ["a", { pattern: "^b$" }, "patternMismatch", { path: "$" }],
  ["a", { pattern: "[" }, "invalidPattern", { path: "$" }],
])("schema validation %j against %j retains a format-ready error descriptor", async (data, rules, key, values) => {
  const result = await execute(schema, JSON.stringify(data), {}, JSON.stringify(rules));
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].messageRef).toEqual({ key: `schema.${key}`, values });
  expect(translator(schemaDefinition)(result.issues[0].messageRef)).toBe(result.issues[0].message);
  expect(translator(schemaDefinition)(result.verdict.detailMessage)).toBe("1 problem");
  expect(result.text).toBe(`Invalid\n- ${result.issues[0].message}`);
});

test("contrast translates pass/fail display values while its downloadable report remains exact", async () => {
  const result = await contrast(context("", { foreground: "#777777", background: "#FFFFFF", canvas: "#FFFFFF" }));
  const translate = translator(contrastDefinition, "fr", {
    "runtime.contrast.pass": "Réussi",
    "runtime.contrast.fail": "Échec",
    "runtime.contrast.aaFail": "Le texte normal échoue au niveau AA",
  });
  expect(result.entries.slice(1, 5).map(({ value }) => value)).toEqual(["Fail", "Pass", "Fail", "Fail"]);
  expect(result.entries.slice(1, 5).map(({ valueMessage }) => translate(valueMessage))).toEqual([
    "Échec",
    "Réussi",
    "Échec",
    "Échec",
  ]);
  const english = translator(contrastDefinition);
  for (const entry of result.entries) expect(english(entry.labelMessage)).toBe(entry.label);
  const displayed = translateToolResult(result, translate);
  expect(displayed.verdict.label).toBe("Le texte normal échoue au niveau AA");
  expect(displayed.entries).toEqual(result.entries);
  expect(displayed.artifacts[0].content).toBe(
    "Contrast ratio: 4.48:1\nAA · normal text: Fail\nAA · large text: Pass\nAAA · normal text: Fail\nAAA · large text: Fail\nDisplayed text: #777777\nDisplayed background: #FFFFFF",
  );
});

test("cURL warnings retain literal flags and leave generated request code byte-for-byte unchanged", async () => {
  const command = `curl 'https://example.com/api' -H 'X-Note: {authored}<tag>' --data-raw 'hello{world}'`;
  const settings = parseSettings(axiosDefinition.settings, {});
  const original = await execute(axios, command, settings);
  const result = await execute(axios, `${command} --compressed --silent --compressed`, settings);
  expect(result.notification.detailMessage).toEqual({
    key: "curl.unsupportedFlags",
    values: { flags: "--compressed, --silent" },
  });
  expect(result.issues[0].messageRef).toEqual(result.notification.detailMessage);
  const translate = translator(axiosDefinition, "fr", {
    "runtime.curl.flagsNotConverted": "Options non converties",
    "runtime.curl.unsupportedFlags": "Options ignorées : {flags}.",
  });
  const displayed = translateToolResult(result, translate);
  expect(displayed.notification.label).toBe("Options non converties");
  expect(displayed.notification.detail).toBe("Options ignorées : --compressed, --silent.");
  expect(displayed.issues[0].message).toBe(displayed.notification.detail);
  expect(displayed.text).toBe(original.text);
  expect(displayed.text).toContain('"X-Note": "{authored}<tag>"');
  expect(displayed.text).toContain('"data": "hello{world}"');
  expect(displayed.downloadName).toBe(original.downloadName);
  expect(original.issues).toBeUndefined();
});

test("JSON precision explanation translates while unsafe integers, decimals and negative zero stay exact", async () => {
  const input = '{"id":9007199254740993,"decimal":0.10000000000000001,"negative":-0,"text":"9007199254740993"}';
  const result = await execute(formatter, input, { indentation: "2", operation: "format" });
  const translate = translator(formatterDefinition, "fr", {
    "runtime.json.exactNumbers": "Nombres exacts conservés",
    "runtime.json.exactNumbersDetail": "La copie et le téléchargement conservent les nombres originaux.",
  });
  expect(result.render).toBe("code");
  expect(result.verdict.labelMessage).toEqual({ key: "json.exactNumbers" });
  expect(result.verdict.detailMessage).toEqual({ key: "json.exactNumbersDetail" });
  const displayed = translateToolResult(result, translate);
  expect(displayed.verdict.label).toBe("Nombres exacts conservés");
  expect(displayed.verdict.detail).toBe("La copie et le téléchargement conservent les nombres originaux.");
  expect(displayed.code).toBe(
    '{\n  "id": 9007199254740993,\n  "decimal": 0.10000000000000001,\n  "negative": -0,\n  "text": "9007199254740993"\n}',
  );
  expect(displayed.downloadName).toBe("smarttools-formatted.json");
  expect(displayed.value).toBeUndefined();
});

test.each([
  colorDefinition,
  cssDefinition,
  dnsDefinition,
  schemaDefinition,
  contrastDefinition,
  axiosDefinition,
  formatterDefinition,
])("$toolId exposes publishable native-ICU source messages", (definition) => {
  const messages = extractToolMessages(definition);
  expect(validateToolTranslation("en", messages, messages, { publish: true })).toEqual([]);
});
