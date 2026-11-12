import { toolSpec } from "./helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { afterEach, test, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { extractToolMessages, toolMessageTree, validateToolTranslation } from "../lib/tool-framework/translations.ts";
import { translateToolResult } from "../lib/tool-framework/result.ts";
import { ToolError } from "../lib/tool-framework/run.ts";
const hashDefinition = await toolSpec("hash-compare");
import { run as compareHashes } from "../tools/hash-compare/run.ts";
const queryDefinition = await toolSpec("url-query-parser");
import { run as parseQuery } from "../tools/url-query-parser/run.ts";
const ratingDefinition = await toolSpec("domain-rating-checker");
import { run as rating } from "../tools/domain-rating-checker/run.server.ts";
const ageDefinition = await toolSpec("domain-age-checker");
import { run as age } from "../tools/domain-age-checker/run.ts";
const graphDefinition = await toolSpec("open-graph-preview");
import { parseMetadata } from "../tools/open-graph-preview/metadata.ts";
import { inspectPage } from "../tools/open-graph-preview/run.server.ts";

vi.mock("@/lib/config/integrations.ts", () => ({ ahrefsApiKey: async () => "" }));
afterEach(() => vi.unstubAllGlobals());
const context = (text, settings = {}, secondary) => ({
  input: { text, secondary, files: [] },
  settings,
  signal: new AbortController().signal,
});
function translator(definition, locale = "en", overrides = {}) {
  const messages = extractToolMessages(definition);
  assert.deepEqual(validateToolTranslation(locale, overrides, messages, { publish: false }), []);
  const t = createTranslator({
    locale,
    namespace: "runtime",
    messages: toolMessageTree({ ...messages, ...overrides }),
    onError(error) {
      throw error;
    },
  });
  return (reference) => {
    assert.ok(reference, "display text has a message reference");
    assert.ok(Object.hasOwn(messages, `runtime.${reference.key}`), "reference is part of the tool's DB contract");
    return t(reference.key, reference.values);
  };
}
async function failure(operation, definition) {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof ToolError);
    const t = translator(definition);
    assert.equal(t(error.details.messageRef), error.message);
    if (error.recovery) assert.equal(t(error.details.recoveryMessage), error.recovery);
    return error;
  }
  assert.fail("Expected execution to fail");
}

test("hash verdict references localize the result while preserving canonical text", () => {
  const translate = translator(hashDefinition, "fr", {
    "runtime.result.match": "Correspondance",
    "runtime.result.noMatch": "Aucune correspondance",
  });
  for (const [right, raw, displayed] of [
    ["ABCD", "Match", "Correspondance"],
    ["ABCE", "No match", "Aucune correspondance"],
  ]) {
    const result = compareHashes(context(" abcd ", {}, right));
    const localized = translateToolResult(result, translate);
    assert.equal(result.text, raw);
    assert.equal(result.verdict.label, raw);
    assert.equal(localized.text, raw);
    assert.equal(localized.verdict.label, displayed);
  }
});

test("query preview headers and empty-state messages localize without changing parsed values", () => {
  const t = translator(queryDefinition, "fr", {
    "runtime.result.parameter": "Paramètre",
    "runtime.result.value": "Valeur",
    "runtime.result.empty": "Aucun paramètre à afficher",
    "runtime.result.emptyValues": "Toutes les valeurs sont vides.",
    "runtime.result.noParameters": "Cette URL ne contient aucun paramètre.",
  });
  const populated = parseQuery(context("?name=%E6%97%A5%E6%9C%AC&name=two&n=004"));
  assert.equal(populated.text, '{\n  "name": [\n    "日本",\n    "two"\n  ],\n  "n": "004"\n}');
  assert.deepEqual(populated.tablePreview.rows, [
    ["name", "日本"],
    ["name", "two"],
    ["n", "004"],
  ]);
  assert.deepEqual(populated.tablePreview.columnMessages.map(t), ["Paramètre", "Valeur"]);
  assert.deepEqual(populated.tablePreview.columns, ["Parameter", "Value"]);
  for (const [input, settings, detail] of [
    ["https://example.com", {}, "Cette URL ne contient aucun paramètre."],
    ["?empty=", { keepEmptyValues: false }, "Toutes les valeurs sont vides."],
  ]) {
    const result = parseQuery(context(input, settings));
    const displayed = translateToolResult(result, t);
    assert.equal(displayed.verdict.label, "Aucun paramètre à afficher");
    assert.equal(displayed.verdict.detail, detail);
    assert.equal(displayed.text, "{}");
  }
});

test.each(["", "https://[broken"])("query error %j has declared error and recovery references", async (input) => {
  await failure(() => parseQuery(context(input)), queryDefinition);
});

test.each([undefined, "", "a".repeat(2049), "ftp://example.com", "localhost"])(
  "rating target error %j retains its specific message contract",
  async (input) => {
    await failure(() => rating(context(input)), ratingDefinition);
  },
);

test.each([401, 429, 503])("rating HTTP %i keeps its stable error code and native parameters", async (status) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status }));
  const error = await failure(() => rating(context("example.com")), ratingDefinition);
  if (status === 503) {
    assert.equal(
      translator(ratingDefinition, "fr", {
        "runtime.errors.upstreamFailed": "La recherche Ahrefs a échoué ({status}).",
      })(error.details.messageRef),
      "La recherche Ahrefs a échoué (503).",
    );
  }
});

test("rating transport and malformed responses use declared first-party errors", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("private diagnostic");
    },
    async () => new Response("not json"),
    async () => Response.json({ domain_rating: { domain_rating: 101 } }),
  ]) {
    vi.stubGlobal("fetch", fetcher);
    const error = await failure(() => rating(context("example.com")), ratingDefinition);
    assert.ok(!error.message.includes("private diagnostic"));
  }
});

test.each(["", "localhost", "https://[broken"])(
  "registration validation %j retains localizable recovery",
  async (input) => {
    await failure(() => age(context(input)), ageDefinition);
  },
);

test("registration failures retain native HTTP values and recovery references", async () => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  const error = await failure(() => age(context("example.com")), ageDefinition);
  const t = translator(ageDefinition, "fr", {
    "runtime.errors.lookupFailed": "Échec de la recherche RDAP ({status}).",
    "runtime.errors.trySupportedTld": "Essayez un domaine comme .com.",
  });
  assert.equal(t(error.details.messageRef), "Échec de la recherche RDAP (404).");
  assert.equal(t(error.details.recoveryMessage), "Essayez un domaine comme .com.");
  for (const fetcher of [
    async () => {
      throw new Error("private diagnostic");
    },
    async () => new Response("not json"),
    async () => Response.json(null),
  ]) {
    vi.stubGlobal("fetch", fetcher);
    await failure(() => age(context("example.com")), ageDefinition);
  }
});

test("Open Graph references distinguish first-party instructions from fetched metadata", () => {
  const t = translator(graphDefinition);
  for (const html of [
    "",
    '<title>Fetched 日本 title</title><meta name="description" content="Fetched description"><meta property="og:image" content="/image.png">',
    '<meta property="og:title" content="Original title"><meta property="og:title" content="Second title"><meta property="og:description" content="Original description"><meta property="og:type" content="article"><meta property="og:url" content="https://example.com/original"><meta name="twitter:card" content="summary">',
  ]) {
    const result = parseMetadata(html, "https://example.com");
    for (const check of result.checks) {
      assert.equal(t(check.labelMessage), check.label);
      if (check.detailMessage) assert.equal(t(check.detailMessage), check.detail);
    }
  }
  const fetched = "Add og:title to control the shared title explicitly.";
  const result = parseMetadata(`<meta property="og:title" content="${fetched}">`, "https://example.com");
  assert.equal(result.metadata.title, fetched);
  assert.equal(result.checks[0].detail, fetched);
  assert.equal(result.checks[0].detailMessage, undefined);
  assert.equal(result.tags, `<meta property="og:title" content="${fetched}">`);
});

test("Open Graph HTTP and image failures carry declared references while keeping fetched content", async () => {
  const network = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => ({ status: 403, headers: new Headers(), body: Readable.from([]) }),
  };
  const error = await failure(() => inspectPage("example.com", new AbortController().signal, network), graphDefinition);
  assert.equal(
    translator(graphDefinition, "fr", { "runtime.errors.httpRejected": "Le site a renvoyé HTTP {status}." })(
      error.details.messageRef,
    ),
    "Le site a renvoyé HTTP 403.",
  );
  let requests = 0;
  const result = await inspectPage("example.com", new AbortController().signal, {
    ...network,
    request: async () =>
      ++requests === 1
        ? {
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
            body: Readable.from([
              '<meta property="og:title" content="Fetched title"><meta property="og:image" content="/image.png">',
            ]),
          }
        : { status: 403, headers: new Headers(), body: Readable.from([]) },
  });
  const imageCheck = result.checks.find((check) => check.property === "image:fetch");
  const t = translator(graphDefinition);
  assert.equal(t(imageCheck.labelMessage), imageCheck.label);
  assert.equal(t(imageCheck.detailMessage), imageCheck.detail);
  assert.equal(result.metadata.title, "Fetched title");
  assert.equal(result.metadata.image.url, "https://example.com/image.png");
  assert.ok(result.tags.includes('content="Fetched title"'));
});
