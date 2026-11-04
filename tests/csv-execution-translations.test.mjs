import { toolSpec } from "./helpers/toolSpec.mjs";
import { expect, test, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { parseStreamingCsv } from "../lib/devtools/shared/streaming-csv.ts";
import { LARGE_CSV_FILE_BYTES, parseCsvRun } from "../lib/devtools/shared/streaming-csv-tool.ts";
import { parseUtilityTable } from "../lib/devtools/shared/table.ts";
import { extractToolMessages, toolMessageTree, validateToolTranslation } from "../lib/tool-framework/translations.ts";
import { translateToolResult } from "../lib/tool-framework/result.ts";
import { run as format } from "../tools/csv-formatter/run.worker.ts";
const formatDefinition = await toolSpec("csv-formatter");
import { run as toJson } from "../tools/csv-to-json/run.worker.ts";
const jsonDefinition = await toolSpec("csv-to-json");
import { run as extract } from "../tools/csv-column-extractor/run.worker.ts";
const extractDefinition = await toolSpec("csv-column-extractor");
import { run as validate } from "../tools/csv-validator/run.worker.ts";
const validatorDefinition = await toolSpec("csv-validator");

function translator(definition, locale = "en", overrides = {}) {
  const translate = createTranslator({
    locale,
    namespace: "runtime",
    messages: toolMessageTree({ ...extractToolMessages(definition), ...overrides }),
    onError(error) {
      throw error;
    },
  });
  return (message) => translate(message.key, message.values);
}

function context(text, settings = {}, streaming = false) {
  const source = new File([text], "input.csv", { type: "text/csv" });
  return {
    input: {
      text: streaming ? "" : text,
      files: streaming
        ? [{ id: "input", name: source.name, mime: source.type, size: LARGE_CSV_FILE_BYTES + 1, source }]
        : [],
    },
    settings,
    signal: new AbortController().signal,
    progress: vi.fn(),
    async writeArtifact({ mime, name, source }) {
      const blob = await new Response(source).blob();
      return { id: "output", jobId: "csv-i18n", name, mime, size: blob.size, createdAt: 0, storage: "blob", blob };
    },
  };
}

async function failure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected CSV validation to fail");
}

test.each([
  ["unexpected-quote", ['id,name\n1,Al"ice'], {}, "csv.errors.streamUnexpectedQuote"],
  ["unexpected-character", ['id,name\n1,"Alice"x'], {}, "csv.errors.streamUnexpectedCharacter"],
  ["unclosed-quote", ['id,name\n1,"Alice'], {}, "csv.errors.streamUnclosedQuote"],
  ["width", ["id,name\n1"], {}, "csv.errors.streamWidth"],
  ["field-too-large", ["12345"], { maxFieldBytes: 4, maxRowBytes: 8 }, "csv.errors.streamFieldTooLarge"],
  ["row-too-large", ["1234,5678"], { maxFieldBytes: 4, maxRowBytes: 7 }, "csv.errors.streamRowTooLarge"],
  ["encoding", [Uint8Array.from([0xff])], {}, "csv.errors.streamEncoding"],
])(
  "streaming %s errors carry explicit ICU metadata without changing English diagnostics",
  async (code, source, options, key) => {
    const error = await failure(() => parseStreamingCsv(source, options));
    expect(error.code).toBe(code);
    expect(error.messageRef.key).toBe(key);
    expect(error.messageRef.values.row).toBe(error.row);
    expect(error.messageRef.values.column).toBe(error.column);
    expect(translator(formatDefinition)(error.messageRef)).toBe(error.message);
  },
);

test("the CSV worker boundary preserves localized error values, coordinates, recovery and progress", async () => {
  const ctx = context("id,name\n1", { delimiter: "," }, true);
  const error = await failure(() => parseCsvRun(ctx, { delimiter: "," }));
  expect(error.code).toBe("csv-width");
  expect(error.message).toBe("Row 2 has 1 column; expected 2 columns.");
  expect(error.details).toMatchObject({
    line: 2,
    column: 2,
    messageRef: { key: "csv.errors.streamWidth", values: { row: 2, actual: 1, expected: 2 } },
    recoveryMessage: { key: "csv.recovery.structure" },
  });
  const translate = translator(formatDefinition, "fr", {
    "runtime.csv.errors.streamWidth":
      "Ligne {row} : {actual, plural, one {# colonne} other {# colonnes}} ; {expected, plural, one {# attendue} other {# attendues}}.",
    "runtime.csv.recovery.structure": "Vérifiez les séparateurs et les guillemets.",
    "runtime.csv.processing": "Traitement des données délimitées",
  });
  expect(translate(error.details.messageRef)).toBe("Ligne 2 : 1 colonne ; 2 attendues.");
  expect(translate(error.details.recoveryMessage)).toBe("Vérifiez les séparateurs et les guillemets.");
  const [progress] = ctx.progress.mock.calls[0];
  expect(progress.stage).toBe("Processing delimited data");
  expect(translate(progress.stageMessage)).toBe("Traitement des données délimitées");
});

test.each([
  ['name\nAl"ice', "csv.errors.unexpectedQuote"],
  ['name\n"Alice"x', "csv.errors.unexpectedCharacter"],
  ['name\n"Alice', "csv.errors.unclosedQuote"],
])("inline quote diagnostics retain distinct references behind the same error code: %s", async (source, key) => {
  const error = await failure(() => parseUtilityTable(source, ","));
  expect(error.code).toBe("invalid-delimited-input");
  expect(error.details.messageRef.key).toBe(key);
  expect(translator(formatDefinition)(error.details.messageRef)).toBe(error.message);
});

test.each([
  ["name,name\nAda,Lin", "shape", "csv.errors.duplicateHeader"],
  ["name,\nAda,Lin", "shape", "csv.errors.emptyHeader"],
  ["name,role\nAda", "shape", "csv.errors.headerWidth"],
  ['name\n"Ada', "syntax", "csv.errors.unclosedQuote"],
])("CSV-to-JSON retains branch-specific error references and the existing code: %s", async (source, code, key) => {
  const error = await failure(() => toJson(context(source, { delimiter: "," })));
  expect(error.code).toBe(code);
  expect(error.details.messageRef.key).toBe(key);
  expect(translator(jsonDefinition)(error.details.messageRef)).toBe(error.message);
  expect(translator(jsonDefinition)(error.details.recoveryMessage)).toBe(error.recovery);
});

test("column selection errors interpolate exact authored column names and bounds", async () => {
  const error = await failure(() =>
    extract(context("name,role\nAda,Admin", { delimiter: ",", column: "{client}<name>" })),
  );
  expect(error.code).toBe("column-not-found");
  const translate = translator(extractDefinition, "fr", {
    "runtime.csv.errors.columnNameMissing": "Colonne {column} introuvable.",
    "runtime.csv.recovery.columnRange": "Choisissez une colonne de 1 à {count}.",
  });
  expect(translate(error.details.messageRef)).toBe('Colonne "{client}<name>" introuvable.');
  expect(translate(error.details.recoveryMessage)).toBe("Choisissez une colonne de 1 à 2.");
});

test("translated streamed CSV metadata leaves CSV bytes, user headers and artifact data unchanged", async () => {
  const ctx = context(' name , note \n Ada ," x,y "', { delimiter: "," }, true);
  const result = await format(ctx);
  const translate = translator(formatDefinition, "fr", {
    "runtime.csv.rows": "Lignes",
    "runtime.csv.columns": "Colonnes",
    "runtime.csv.download": "Télécharger",
  });
  const displayed = translateToolResult(result, translate);
  expect(result.stats.map((stat) => translate(stat.labelMessage))).toEqual(["Lignes", "Colonnes"]);
  expect(displayed.sections[0].title).toBe("Télécharger");
  expect(displayed.code).toBe('name,note\nAda,"x,y"');
  expect(displayed.tablePreview.columns).toEqual(["name", "note"]);
  expect(displayed.stats.map((stat) => stat.value)).toEqual(["2", "2"]);
  expect(displayed.sections[0].body.files[0]).toBe(result.sections[0].body.files[0]);
  expect(await displayed.sections[0].body.files[0].blob.text()).toBe('name,note\nAda,"x,y"');
});

test.each([false, true])("CSV-to-JSON display metadata preserves exact output (streaming=%s)", async (streaming) => {
  const result = await toJson(context('id,note\n9007199254740993,"français"', { delimiter: "," }, streaming));
  const translate = translator(jsonDefinition, "fr", {
    "runtime.csv.rows": "Lignes",
    "runtime.csv.columns": "Colonnes",
  });
  const displayed = translateToolResult(result, translate);
  expect(result.stats.map((stat) => translate(stat.labelMessage))).toEqual(["Lignes", "Colonnes"]);
  expect(displayed.text ?? displayed.code).toBe(result.text ?? result.code);
  const output = streaming ? await displayed.sections[0].body.files[0].blob.text() : displayed.text;
  expect(JSON.parse(output)).toEqual([{ id: "9007199254740993", note: "français" }]);
});

test("CSV validation localizes its verdict while preserving the original copyable report", async () => {
  const result = await validate(context("name,role\nAda,Admin", { delimiter: "," }));
  const translate = translator(validatorDefinition, "fr", {
    "runtime.csv.valid": "CSV valide",
    "runtime.csv.validDetail":
      "{columns, plural, one {# colonne} other {# colonnes}} · {rows, plural, one {# ligne} other {# lignes}}",
  });
  const displayed = translateToolResult(result, translate);
  expect(displayed.verdict.label).toBe("CSV valide");
  expect(displayed.verdict.detail).toBe("2 colonnes · 1 ligne");
  expect(displayed.text).toBe("Valid CSV\nColumns: 2\nData rows: 1");
});

test.each([
  "csv-column-extractor",
  "csv-delimiter-converter",
  "csv-duplicate-remover",
  "csv-filter",
  "csv-formatter",
  "csv-sorter",
  "csv-to-json",
  "csv-to-markdown-table",
  "csv-to-table",
  "csv-to-tsv",
  "csv-validator",
  "csv-viewer",
  "tsv-to-csv",
])("%s exposes valid seedable native-ICU execution messages", async (key) => {
  const definition = await toolSpec(key);
  const messages = extractToolMessages(definition);
  expect(messages["runtime.csv.processing"]).toBe("Processing delimited data");
  expect(messages["runtime.csv.errors.streamWidth"]).toContain("plural");
  expect(validateToolTranslation("en", messages, messages, { publish: true })).toEqual([]);
});
