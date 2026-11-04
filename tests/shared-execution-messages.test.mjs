import { toolSpec } from "./helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { requireUtilityInput } from "../lib/devtools/shared/options.ts";
import { base64ToBytes, decodeBase64 } from "../lib/devtools/shared/encoding.ts";
import { getCrypto, randomString, secureRandomInt } from "../lib/devtools/shared/crypto.ts";
import { normalizeDomain, safeUrl } from "../lib/devtools/shared/url.ts";
import { parseDate } from "../lib/devtools/shared/datetime.ts";
import { decodeJwt } from "../lib/devtools/shared/jwt.ts";
import { protectCssStrings, tokenizeJavaScript } from "../lib/devtools/shared/code.ts";
import { parseCurl, shellTokens } from "../lib/devtools/shared/curl.ts";
import { diffLines } from "../lib/devtools/shared/line-diff.ts";
import { parseStrictJson, parseUtilityJson, repairModeFromOptions } from "../lib/devtools/shared/json-input.ts";
import { convertJsonToCsv } from "../lib/devtools/shared/csv.ts";
import { transformLargeJsonRun, validateStreamingJsonRun } from "../lib/devtools/shared/streaming-json-tool.ts";
import { ToolError } from "../lib/tool-framework/run.ts";
import { extractToolMessages, toolMessageTree } from "../lib/tool-framework/translations.ts";
import { context } from "./helpers/json-tools.mjs";
import { createArtifactWriter, readArtifact } from "../lib/tool-framework/artifacts.ts";
import { run as replaceText } from "../tools/find-and-replace/run.ts";
import { run as rgbToHex } from "../tools/rgb-to-hex/run.ts";
import { validateImageFile } from "../tools/image-color-picker/model.ts";

afterEach(() => vi.unstubAllGlobals());

const definitions = new Map();
async function format(tool, message, overrides = {}, locale = "en") {
  if (!definitions.has(tool)) definitions.set(tool, await toolSpec(tool));
  const messages = extractToolMessages(definitions.get(tool));
  expect(Object.hasOwn(messages, `runtime.${message.key}`)).toBe(true);
  return createTranslator({
    locale,
    namespace: "runtime",
    messages: toolMessageTree({ ...messages, ...overrides }),
    onError(error) {
      throw error;
    },
  })(message.key, message.values);
}

async function failure(run) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect(error.details.messageRef).toBeDefined();
    return error;
  }
  throw new Error("Expected ToolError");
}

test.each([
  [
    "base64-decoder",
    () => requireUtilityInput(" ", "Base64 input"),
    "input-required",
    "sharedInput.required",
    "Base64 input is required.",
  ],
  ["base64-decoder", () => base64ToBytes("%%"), "invalid-base64", "sharedEncoding.base64", "Base64 input is invalid."],
  [
    "base64-decoder",
    () => decodeBase64("/w=="),
    "invalid-base64-text",
    "sharedEncoding.utf8",
    "Base64 does not contain valid UTF-8 text.",
  ],
  [
    "random-number-generator",
    () => secureRandomInt(0),
    "invalid-random-range",
    "sharedCrypto.range",
    "Random range is too large.",
  ],
  [
    "password-generator",
    () => randomString(1, ""),
    "missing-character-group",
    "sharedCrypto.alphabet",
    "Choose at least one character group.",
  ],
  ["dns-checker", () => normalizeDomain(""), "input-required", "sharedUrl.domainRequired", "Domain is required."],
  [
    "dns-checker",
    () => normalizeDomain("localhost"),
    "invalid-domain",
    "sharedUrl.domain",
    "Enter a valid domain name.",
  ],
  [
    "utm-builder",
    () => safeUrl("ftp://example.com", "Destination URL"),
    "invalid-url",
    "sharedUrl.absolute",
    "Destination URL must be an absolute http or https URL.",
  ],
  [
    "timestamp-converter",
    () => parseDate("not-a-date", "Timestamp or date"),
    "invalid-date",
    "sharedDate.invalid",
    "Timestamp or date is not a valid date or timestamp.",
  ],
  [
    "jwt-decoder",
    () => decodeJwt("a.b"),
    "invalid-jwt",
    "sharedJwt.parts",
    "JWT must contain three dot-separated parts.",
  ],
  [
    "jwt-decoder",
    () => decodeJwt("e30.W10.sig"),
    "invalid-jwt",
    "sharedJwt.payload",
    "JWT header or payload is not valid Base64URL JSON.",
  ],
  [
    "css-minifier",
    () => protectCssStrings('a{content:"unfinished'),
    "invalid-source",
    "sharedCode.string",
    "Source contains an unfinished string.",
  ],
  [
    "css-minifier",
    () => protectCssStrings("/* unfinished"),
    "invalid-source",
    "sharedCode.comment",
    "Source contains an unfinished comment.",
  ],
  [
    "javascript-formatter",
    () => tokenizeJavaScript("const = ;"),
    "invalid-source",
    "sharedCode.syntax",
    "Source contains invalid JavaScript syntax.",
  ],
  [
    "javascript-minifier",
    () => tokenizeJavaScript('const a = "unfinished', true),
    "unterminated",
    "sharedCode.unterminated",
    "Source contains an unfinished string, regex, or comment.",
  ],
  [
    "curl-to-axios",
    () => shellTokens('curl "unfinished'),
    "invalid-curl",
    "sharedCurl.quote",
    "cURL command contains an unfinished quote or escape.",
  ],
  [
    "curl-to-fetch",
    () => parseCurl("wget https://example.com"),
    "invalid-curl",
    "sharedCurl.start",
    "Command must start with curl.",
  ],
  [
    "curl-to-fetch",
    () => parseCurl("curl https://example.com -H invalid"),
    "invalid-curl-header",
    "sharedCurl.header",
    "Every cURL header needs a name and value.",
  ],
  [
    "curl-to-fetch",
    () => parseCurl("curl invalid"),
    "invalid-url",
    "sharedCurl.absolute",
    "cURL command needs an absolute http or https URL.",
  ],
  [
    "curl-to-fetch",
    () => parseCurl("curl ftp://example.com"),
    "invalid-url",
    "sharedCurl.protocol",
    "cURL URL must use http or https.",
  ],
  [
    "json-editor",
    () => repairModeFromOptions({ repairMode: "wrong" }),
    "invalid-json-repair-mode",
    "jsonExecution.repairMode",
    "Choose a valid JSON repair mode.",
  ],
  [
    "json-editor",
    () => parseUtilityJson("{", { repairMode: "off" }),
    "invalid-json",
    "jsonExecution.invalidInput",
    "JSON input is not valid JSON.",
  ],
  [
    "json-schema-validator",
    () => parseStrictJson("{", "JSON schema", "schema"),
    "invalid-json",
    "jsonExecution.invalidInput",
    "JSON schema is not valid JSON.",
  ],
  [
    "find-and-replace",
    () => replaceText(context("source", { find: "" })),
    "find-required",
    "find.required",
    "Find text is required.",
  ],
  [
    "find-and-replace",
    () => replaceText(context("source", { find: "[", replace: "", regex: true })),
    "pattern-invalid",
    "find.regexError",
    "Find pattern is not a valid regular expression.",
  ],
  [
    "rgb-to-hex",
    () => rgbToHex(context("red")),
    "syntax",
    "rgb.functionRequired",
    "Enter rgb() or rgba(), using commas or spaces with / alpha.",
  ],
  [
    "image-color-picker",
    () => validateImageFile({ type: "image/svg+xml", size: 20 }),
    "unsupported-image",
    "image.unsupported",
    "Choose a PNG, JPEG, WebP, or GIF image.",
  ],
  [
    "image-color-picker",
    () => validateImageFile({ type: "image/png", size: 0 }),
    "image-size",
    "image.size",
    "Choose a nonempty image smaller than 20 MB.",
  ],
])(
  "%s preserves the %s failure diagnostic and exposes an editable native message",
  async (tool, run, code, key, diagnostic) => {
    const error = await failure(run);
    expect(error.code).toBe(code);
    expect(error.message).toBe(diagnostic);
    expect(error.details.messageRef.key).toBe(key);
    expect(await format(tool, error.details.messageRef, { [`runtime.${key}`]: "Corrigez cette entrée." }, "fr")).toBe(
      "Corrigez cette entrée.",
    );
    if (error.recovery) expect(await format(tool, error.details.recoveryMessage)).toBe(error.recovery);
  },
);

test("secure crypto absence and comparison limits retain explicit failure refs", async () => {
  vi.stubGlobal("crypto", undefined);
  const crypto = await failure(getCrypto);
  expect(await format("uuid-generator", crypto.details.messageRef)).toBe(crypto.message);
  const diff = await failure(() => diffLines("x\n".repeat(2_001), "x\n".repeat(2_001)));
  expect(diff.code).toBe("comparison-too-large");
  expect(await format("text-diff-checker", diff.details.messageRef)).toBe(diff.message);
  expect(await format("text-diff-checker", diff.details.recoveryMessage)).toBe(diff.recovery);
});

test("shared JSON size errors retain numeric ICU values rather than parsing diagnostic prose", async () => {
  const error = await failure(() => parseUtilityJson(" ".repeat(2_000_000) + "{}", { repairMode: "remove" }));
  expect(error.details.messageRef).toEqual({
    key: "jsonExecution.inputTooLarge",
    values: { input: "json", limit: 2_000_000 },
  });
  expect(error.message).toBe("JSON must be 2,000,000 characters or fewer.");
  expect(await format("json-editor", error.details.messageRef)).toBe(
    "JSON input must be 2,000,000 characters or fewer.",
  );
});

test.each([
  ["", {}, "empty", "jsonCsv.empty"],
  ["{}", { delimiter: ":" }, "configuration", "jsonCsv.delimiter"],
  ["{", { repairMode: "off" }, "syntax", "jsonCsv.invalid"],
  ["[1]", {}, "shape", "jsonCsv.shape"],
])("JSON-to-CSV carries a branch-specific error for %s", async (input, options, kind, key) => {
  const result = convertJsonToCsv(input, options);
  expect(result.ok).toBe(false);
  expect(result.error.kind).toBe(kind);
  expect(result.error.messageRef.key).toBe(key);
  expect(await format("json-to-csv", result.error.messageRef)).toBe(result.error.message);
});

test("streaming JSON localizes progress, facts and file sections while preserving exact code and files", async () => {
  const input = '{"a":9007199254740993}';
  const setup = context(input, {});
  const progress = [];
  const artifacts = createArtifactWriter("shared-execution-message-test");
  const ctx = {
    ...setup,
    input: { ...setup.input, files: [{ name: "data.json", size: input.length, source: new Blob([input]) }] },
    progress: (value) => progress.push(value),
    writeArtifact: artifacts.write,
  };
  const validated = await validateStreamingJsonRun(ctx);
  expect(validated.code).toBe(input);
  expect(await format("json-validator", validated.stats[0].labelMessage)).toBe("Status");
  expect(await format("json-validator", validated.stats[0].valueMessage)).toBe("Valid JSON");
  expect(
    await format(
      "json-validator",
      validated.stats[1].valueMessage,
      {
        "runtime.jsonExecution.rootValue": "{type, select, object {Objet} other {Valeur}}",
      },
      "fr",
    ),
  ).toBe("Objet");
  expect(await format("json-validator", validated.stats[2].valueMessage)).toBe(`${input.length} bytes`);
  expect(progress.length).toBeGreaterThan(0);
  expect(await format("json-validator", progress[0].stageMessage)).toBe("Processing JSON");
  const transformed = await transformLargeJsonRun(ctx, { mode: "minify", name: "data.json" });
  expect(transformed.code).toBe(input);
  expect(await format("json-minifier", transformed.sections[0].titleMessage)).toBe("Download");
  expect(await (await readArtifact(transformed.sections[0].body.files[0])).text()).toBe(input);
});

test("streaming JSON error coordinates and raw diagnostics survive translation", async () => {
  const setup = context('{"x":}', {});
  const error = await failure(() => validateStreamingJsonRun(setup));
  expect(error.code).toBe("json-syntax");
  expect(error.message).toContain("Near line 1, column");
  expect(error.details.messageRef.values).toEqual({ line: error.details.line, column: error.details.column });
  expect(
    await format(
      "json-validator",
      error.details.messageRef,
      {
        "runtime.jsonExecution.syntax": "JSON incorrect à la ligne {line, number}, colonne {column, number}.",
      },
      "fr",
    ),
  ).toBe(`JSON incorrect à la ligne 1, colonne ${error.details.column}.`);
  expect(await format("json-validator", error.details.recoveryMessage)).toBe(error.recovery);
});
