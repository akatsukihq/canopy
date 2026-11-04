import { toolSpec } from "./helpers/toolSpec.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { parseSettings } from "../lib/tool-framework/settings.ts";
import { translateToolResult } from "../lib/tool-framework/result.ts";
import { extractToolMessages, toolMessageTree, validateToolTranslation } from "../lib/tool-framework/translations.ts";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function tool(key) {
  const definition = await toolSpec(key);
  const { run } = await import(
    `../tools/${key}/${["json-validator", "json-viewer"].includes(key) ? "run.worker" : "run"}.ts`
  );
  return {
    definition,
    execute: (text = "", settings = {}, secondary = "") =>
      run({
        input: { text, secondary, files: [] },
        settings: { ...parseSettings(definition.settings, {}), ...settings },
        signal: new AbortController().signal,
      }),
  };
}

function translator(definition, locale = "en", overrides = {}) {
  const messages = extractToolMessages(definition);
  expect(validateToolTranslation(locale, overrides, messages, { publish: false })).toEqual([]);
  const t = createTranslator({
    locale,
    namespace: "runtime",
    messages: toolMessageTree({ ...messages, ...overrides }),
    onError(error) {
      throw error;
    },
  });
  return (ref) => {
    expect(Object.hasOwn(messages, `runtime.${ref.key}`)).toBe(true);
    return t(ref.key, ref.values);
  };
}

async function failure(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected tool validation to fail");
}

test.each([
  ["api-key-generator", "", { prefix: "bad prefix" }, "invalid-prefix"],
  ["basic-auth-generator", "user:name", {}, "invalid-username"],
  ["basic-auth-generator", "user\nname", {}, "invalid-credentials"],
  ["bearer-token-parser", "token", { inputFormat: "header" }, "authorization-header-required"],
  ["binary-to-text", "01", {}, "invalid-binary"],
  ["binary-to-text", "11111111", {}, "invalid-utf8"],
  ["border-radius-generator", "", { unit: "bad" }, "invalid-unit"],
  ["border-radius-generator", "", { topLeft: -1 }, "invalid-radius"],
  ["diagram-generator", "x".repeat(200_001), {}, "diagram-too-large"],
  ["diagram-generator", "graph TD; A --> B", {}, "dom-required"],
  ["hex-to-text", "f", {}, "invalid-hex"],
  ["hex-to-text", "ff", {}, "invalid-utf8"],
  ["hmac-generator", "message", {}, "secret-required"],
  ["http-status-codes", "no such status", {}, "no-match"],
  ["json-array-to-table", "[1]", {}, "shape"],
  ["json-array-to-table", "[{}]", {}, "empty-columns"],
  ["json-unescape", String.raw`\q`, {}, "invalid-escape"],
  ["json-path-tester", "{}", { path: "" }, "path-required"],
  ["json-path-tester", "{}", { path: "$..name" }, "path-unsupported"],
  ["json-path-tester", "{}", { path: "$.name" }, "path-no-match"],
])("%s %s reports %s with a seedable branch-specific descriptor", async (key, input, settings, code) => {
  const { definition, execute } = await tool(key);
  const error = await failure(() => execute(input, settings));
  expect(error.code).toBe(code);
  expect(error.details.messageRef).toEqual({ key: `execution.errors.${code}` });
  const t = translator(definition);
  expect(t(error.details.messageRef)).toBe(error.message);
  if (error.recovery) expect(t(error.details.recoveryMessage)).toBe(error.recovery);
});

test.each(["start", "end"])(
  "date input errors select the %s endpoint without translating its identifier",
  async (endpoint) => {
    const { definition, execute } = await tool("date-difference");
    const error = await failure(() => execute("2026-01-01", { [`${endpoint}Time`]: "25:00" }, "2026-01-02"));
    expect(error.details.messageRef.values).toEqual({ endpoint });
    const t = translator(definition, "fr", {
      "runtime.execution.errors.time-invalid":
        "{endpoint, select, start {Heure de début} end {Heure de fin} other {Heure}} : format invalide.",
      "runtime.execution.recovery.time-invalid":
        "Corrigez {endpoint, select, start {le début} end {la fin} other {l’heure}}.",
    });
    expect(t(error.details.messageRef)).toBe(
      endpoint === "start" ? "Heure de début : format invalide." : "Heure de fin : format invalide.",
    );
    expect(t(error.details.recoveryMessage)).toBe(endpoint === "start" ? "Corrigez le début." : "Corrigez la fin.");
  },
);

test("diagram errors localize their wrapper and retain the original parser diagnostic", async () => {
  vi.stubGlobal("document", {});
  const { default: mermaid } = await import("mermaid");
  mermaid.render.mockRejectedValueOnce(new Error("line 2: {authored}<node>"));
  const { definition, execute } = await tool("diagram-generator");
  const error = await failure(() => execute("graph TD; A --> B"));
  const t = translator(definition, "fr", {
    "runtime.execution.errors.diagram-invalid": "Diagramme invalide : {diagnostic}",
  });
  expect(error.message).toBe("Mermaid diagram is invalid: line 2: {authored}<node>");
  expect(t(error.details.messageRef)).toBe("Diagramme invalide : line 2: {authored}<node>");
});

test("bcrypt comparison exposes localized verdicts without changing its canonical output", async () => {
  const { definition, execute } = await tool("bcrypt-compare");
  const { default: bcrypt } = await import("bcryptjs");
  const hash = await bcrypt.hash("fixture password", 4);
  const t = translator(definition, "fr", {
    "runtime.execution.match": "Correspondance",
    "runtime.execution.noMatch": "Aucune correspondance",
  });
  for (const [password, text, translated] of [
    ["fixture password", "Match", "Correspondance"],
    ["other password", "No match", "Aucune correspondance"],
  ]) {
    const result = await execute(password, {}, hash);
    const displayed = translateToolResult(result, t);
    expect(displayed.text).toBe(text);
    expect(displayed.verdict.label).toBe(translated);
    expect(JSON.stringify(result)).not.toContain(password);
  }
});

test("character count headings translate independently of exact counts and the copyable report", async () => {
  const { definition, execute } = await tool("character-counter");
  const result = await execute("A 😀\r\n", { limit280: true });
  const t = translator(definition, "fr", {
    "runtime.execution.characters": "Caractères",
    "runtime.execution.remaining": "Restants",
  });
  expect(result.text).toBe(
    "Characters: 5 / 280\nRemaining: 275\nCharacters without spaces: 2\nWords: 2\nLines: 2\nUTF-8 bytes: 8",
  );
  expect(result.tablePreview.rows.slice(0, 2)).toEqual([
    ["Characters", "5 / 280"],
    ["Remaining", "275"],
  ]);
  expect(result.tablePreview.rowMessages.slice(0, 2).map(([ref]) => t(ref))).toEqual(["Caractères", "Restants"]);
});

test("Base64 image metadata translates without changing image bytes or dimensions", async () => {
  const { definition, execute } = await tool("base64-decoder");
  const input = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const result = await execute(input);
  const displayed = translateToolResult(
    result,
    translator(definition, "fr", {
      "runtime.execution.gifDecoded": "GIF décodé · {width} × {height} px",
      "runtime.execution.decodedImage": "Image Base64 décodée",
    }),
  );
  expect(displayed.alt).toBe("Image Base64 décodée");
  expect(displayed.notification.label).toBe("GIF décodé · 1 × 1 px");
  expect(displayed.src).toBe(`data:image/gif;base64,${input}`);
  expect([displayed.width, displayed.height]).toEqual([1, 1]);
});

test("checksum headings and bearer facts translate while hashes and token values remain canonical", async () => {
  const checksum = await tool("checksum-generator");
  const result = await checksum.execute("fixture");
  const t = translator(checksum.definition, "fr", {
    "runtime.execution.algorithm": "Algorithme",
    "runtime.execution.checksum": "Empreinte",
  });
  expect(result.tablePreview.columnMessages.map(t)).toEqual(["Algorithme", "Empreinte"]);
  expect(result.tablePreview.rows.map(([algorithm]) => algorithm)).toEqual(["MD5", "SHA-1", "SHA-256", "SHA-512"]);
  expect(result.text.split("\n").map((line) => line.trim().split(/\s+/))).toEqual(result.tablePreview.rows);
  const bearer = await tool("bearer-token-parser");
  const token = "{authored}<token>";
  const parsed = await bearer.execute(token, { inputFormat: "raw", decodeJwtParts: false });
  const translated = translator(bearer.definition, "fr", {
    "runtime.execution.token": "Jeton",
    "runtime.execution.length": "Longueur",
  });
  expect(parsed.entries.map(({ labelMessage }) => translated(labelMessage))).toEqual(["Jeton", "Longueur"]);
  expect(parsed.entries.map(({ value }) => value)).toEqual([token, String(token.length)]);
});

test("JSON-to-CSV display facts preserve authored columns and copied bytes", async () => {
  const { definition, execute } = await tool("json-to-csv");
  const result = await execute('{"name{raw}<tag>":"Ada","missing":}', { repairMode: "null" });
  const t = translator(definition, "fr", {
    "runtime.execution.rows": "Lignes",
    "runtime.execution.columns": "Colonnes",
    "runtime.execution.repaired": "Réparé",
    "runtime.execution.yes": "Oui",
  });
  expect(result.stats.map(({ labelMessage }) => t(labelMessage))).toEqual(["Lignes", "Colonnes", "Réparé"]);
  expect(t(result.stats[2].valueMessage)).toBe("Oui");
  expect(result.stats[2].value).toBe("Yes");
  expect(result.tablePreview.columns).toEqual(["name{raw}<tag>", "missing"]);
  expect(result.text).toBe("name{raw}<tag>,missing\nAda,");
});

test("date duration messages retain the sign and raw elapsed-time report", async () => {
  const { definition, execute } = await tool("date-difference");
  const result = await execute("2026-01-02T00:00:00Z", {}, "2026-01-01T00:00:00Z");
  const displayed = translateToolResult(
    result,
    translator(definition, "fr", { "runtime.execution.exactDuration": "{days} jours ({hours} heures)" }),
  );
  expect(displayed.verdict.label).toBe("-1 jours (-24 heures)");
  expect(displayed.text).toBe("-1 days (-24 hours)");
});

test("ISO batch display localizes labels and retains selected date formats, source offsets and raw items", async () => {
  const { definition, execute } = await tool("iso-date-converter");
  const result = await execute("2026-07-22T12:30:00+05:30\n2026-07-23T12:30:00+05:30", {
    displayTimezone: "utc",
    locale: "en-GB",
    preserveOffset: true,
    showUtc: false,
  });
  const t = translator(definition, "fr", {
    "runtime.execution.withoutUtc":
      "ISO : {iso}\n{display, select, utc {Affichage UTC} local {Heure locale} other {Heure locale}} : {readable}\nUnix : {unix}",
  });
  expect(t(result.itemMessages[0])).toBe(
    "ISO : 2026-07-22T12:30:00.000+05:30\nAffichage UTC : 22/07/2026, 07:00:00\nUnix : 1784703600",
  );
  expect(result.items[0]).toBe(
    "ISO: 2026-07-22T12:30:00.000+05:30\nDisplay (UTC): 22/07/2026, 07:00:00\nUnix: 1784703600",
  );
  expect(result.labels).toEqual(["2026-07-22T12:30:00+05:30", "2026-07-23T12:30:00+05:30"]);
});

test("JSON diff translates counts and headings while preserving exact source lines and caught error references", async () => {
  const { definition, execute } = await tool("json-diff");
  const result = await execute("null", { repairMode: "off" }, "false");
  const t = translator(definition, "fr", {
    "runtime.execution.changed":
      "{added, plural, one {# ligne ajoutée} other {# lignes ajoutées}} · {removed, plural, one {# ligne supprimée} other {# lignes supprimées}}",
    "runtime.execution.original": "JSON A · Original",
    "runtime.execution.changedSide": "JSON B · Modifié",
  });
  const displayed = translateToolResult(result, t);
  expect(displayed.verdict.label).toBe("1 ligne ajoutée · 1 ligne supprimée");
  expect(displayed.rightLabel).toBe("JSON B · Modifié");
  expect(displayed.lines).toEqual([
    { kind: "removed", text: "null" },
    { kind: "added", text: "false" },
  ]);
  const error = await failure(() => execute("{}", { repairMode: "off" }, `${"[".repeat(130)}0${"]".repeat(130)}`));
  expect(error.message).toMatch(/^JSON B:/);
  expect(error.details.messageRef).toEqual({
    key: "execution.errors.comparisonTooDeepSide",
    values: { side: "JSON B" },
  });
  expect(t(error.details.messageRef)).toBe("JSON B: This JSON is nested too deeply to compare safely.");
});

test("JSON validation localizes status and keeps the raw report and root type unchanged", async () => {
  const { definition, execute } = await tool("json-validator");
  const result = await execute("[1]");
  const displayed = translateToolResult(
    result,
    translator(definition, "fr", {
      "runtime.execution.valid": "JSON valide",
      "runtime.execution.rootType": "Type racine : {type}",
    }),
  );
  expect(displayed.verdict.label).toBe("JSON valide");
  expect(displayed.verdict.detail).toBe("Type racine : array");
  expect(displayed.text).toBe("Valid JSON\nRoot type: array");
});

test.each(["left", "right"])(
  "JSON comparison preserves the %s input role for missing and invalid input",
  async (side) => {
    const { definition, execute } = await tool("json-diff");
    const t = translator(definition, "fr", {
      "runtime.jsonExecution.required":
        "{input, select, left {JSON A} right {JSON B} data {Données JSON} schema {Schéma JSON} other {JSON}} : requis.",
      "runtime.jsonExecution.invalidInput":
        "{input, select, left {JSON A} right {JSON B} data {Données JSON} schema {Schéma JSON} other {JSON}} : invalide.",
    });
    for (const [input, suffix, text] of [
      ["", "required", "requis"],
      ["{", "invalidInput", "invalide"],
    ]) {
      const error = await failure(() =>
        execute(side === "left" ? input : "{}", { repairMode: "off" }, side === "right" ? input : "{}"),
      );
      expect(error.details.messageRef).toEqual({ key: `jsonExecution.${suffix}`, values: { input: side } });
      expect(t(error.details.messageRef)).toBe(`${side === "left" ? "JSON A" : "JSON B"} : ${text}.`);
      expect(error.message).toContain(side === "left" ? "JSON A" : "JSON B");
    }
  },
);

test.each(["start", "end"])(
  "date comparison preserves the %s endpoint for missing and invalid dates",
  async (endpoint) => {
    const { definition, execute } = await tool("date-difference");
    const t = translator(definition, "fr", {
      "runtime.sharedDate.required":
        "{endpoint, select, start {Date de début} end {Date de fin} other {Date}} : requise.",
      "runtime.sharedDate.invalid":
        "{endpoint, select, start {Date de début} end {Date de fin} other {Date}} : invalide.",
    });
    for (const [input, suffix, text] of [
      ["", "required", "requise"],
      ["invalid", "invalid", "invalide"],
    ]) {
      const error = await failure(() =>
        execute(endpoint === "start" ? input : "2026-01-01", {}, endpoint === "end" ? input : "2026-01-02"),
      );
      expect(error.details.messageRef).toEqual({ key: `sharedDate.${suffix}`, values: { endpoint } });
      expect(t(error.details.messageRef)).toBe(`${endpoint === "start" ? "Date de début" : "Date de fin"} : ${text}.`);
      expect(error.message).toContain(endpoint === "start" ? "Start date" : "End date");
    }
  },
);

test.each(["exp", "nbf", "iat"])("JWT invalid %s claims retain canonical names in translated errors", async (claim) => {
  const { definition, execute } = await tool("jwt-expiration-checker");
  const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ [claim]: "invalid" })).toString("base64url")}.`;
  const error = await failure(() => execute(token));
  expect(error.code).toBe("invalid-numeric-date");
  expect(error.details.messageRef.values).toEqual({ claim });
  const t = translator(definition, "fr", {
    "runtime.execution.errors.numericDate": "La valeur {claim} doit être un NumericDate valide.",
  });
  expect(t(error.details.messageRef)).toBe(`La valeur ${claim} doit être un NumericDate valide.`);
  expect(JSON.stringify(error.details)).not.toContain(token);
});

test.each([
  "api-key-generator",
  "base64-decoder",
  "basic-auth-generator",
  "bcrypt-compare",
  "bearer-token-parser",
  "binary-to-text",
  "border-radius-generator",
  "character-counter",
  "checksum-generator",
  "date-difference",
  "diagram-generator",
  "hex-to-text",
  "hmac-generator",
  "http-status-codes",
  "iso-date-converter",
  "json-array-to-table",
  "json-diff",
  "json-path-tester",
  "json-to-csv",
  "json-unescape",
  "json-validator",
  "json-viewer",
  "jwt-expiration-checker",
])("%s execution messages pass the publication ICU contract", async (key) => {
  const definition = await toolSpec(key);
  const messages = extractToolMessages(definition);
  expect(validateToolTranslation("en", messages, messages, { publish: true })).toEqual([]);
});
