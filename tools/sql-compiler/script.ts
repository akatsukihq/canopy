/**
 * Pure SQL-script logic shared by the engine worker, the run adapter and the
 * workspace: statement splitting, bounded execution against an opened SQLite
 * module, and CSV text. Nothing here touches the DOM, a Worker or the network,
 * so Node tests exercise the real SQLite engine through it.
 *
 * Results cross the worker boundary as plain data, and cells are strings or
 * `null` (SQL NULL), never markup.
 */

/** Keep equal to the version scripts/copy-media-vendor.mjs copies; a test checks it. */
export const SQLITE_VERSION = "3.54.1-build1";
export const SQLITE_VENDOR_URL = `/code/vendor/sqlite/${SQLITE_VERSION}`;
/** PGlite 0.5.14 is PostgreSQL 18.6. Keep equal to the installed package; a test checks it. */
export const PGLITE_VERSION = "0.5.14";
export const PGLITE_VENDOR_URL = `/code/vendor/pglite/${PGLITE_VERSION}`;

export type SqlEngine = "sqlite" | "postgres";
export const SQL_ENGINES: readonly SqlEngine[] = ["sqlite", "postgres"];
/** Untrusted settings value to a known engine; anything else is SQLite. */
export const toEngine = (value: unknown): SqlEngine => (value === "postgres" ? "postgres" : "sqlite");

export const SQL_LIMITS = {
  sourceBytes: 64 * 1024,
  displayRows: 1_000,
  resultSets: 20,
  runMs: 5_000,
  /** CSV keeps going past the display cap, up to this many characters over all sets. */
  csvChars: 16_000_000,
} as const;

export type SqlCell = string | null;

export type SqlResultSet = {
  /** 1-based line of the statement that produced it. */
  readonly line: number;
  readonly columns: readonly string[];
  /** At most `displayRows` rows. */
  readonly rows: readonly (readonly SqlCell[])[];
  readonly totalRows: number;
  readonly csv: string;
  /** False when the CSV budget ran out before every row was written. */
  readonly csvComplete: boolean;
  /** Set for EXPLAIN statements, whose rows describe how SQLite runs a query rather than hold data. */
  readonly explain?: "plan" | "bytecode";
};

export type SqlOutcome = {
  /** Absent on outcomes from before PostgreSQL existed: SQLite. */
  readonly engine?: SqlEngine;
  readonly statements: number;
  readonly durationMs: number;
  readonly sets: readonly SqlResultSet[];
  /** Queries after the 20th: they ran, but no grid is kept. */
  readonly setsOmitted: number;
  /** Statements that changed rows. */
  readonly writes: readonly { readonly line: number; readonly rows: number }[];
  readonly error?: { readonly line: number; readonly statement: number; readonly message: string };
};

/** `start`/`end` are character offsets of the statement text (without its closing semicolon). */
export type SqlStatement = {
  readonly sql: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
};

/**
 * A scoped run covers the `"start:end"` character range it was asked for.
 * Text after `end` is dropped. Earlier statements stay in the source because a
 * statement often needs them (its table); `executeScript` runs them silently
 * from `from` onwards, so results and line numbers still match the editor.
 */
export function parseScope(
  source: string,
  scope?: string,
  engine: SqlEngine = "sqlite",
): { source: string; from: number } {
  const match = /^(?:(plan|bytecode):)?(\d+):(\d+)$/.exec(scope ?? "");
  if (!match) return { source, from: 0 };
  const from = Math.min(Number(match[2]), source.length);
  const end = Math.min(Number(match[3]), source.length);
  if (end <= from) return { source, from: 0 };
  // Explaining prefixes the statement; earlier statements keep their offsets and still run as setup.
  // PostgreSQL has no bytecode view: both modes show its plan.
  const prefix =
    engine === "postgres"
      ? match[1]
        ? "EXPLAIN "
        : ""
      : match[1] === "plan"
        ? "EXPLAIN QUERY PLAN "
        : match[1] === "bytecode"
          ? "EXPLAIN "
          : "";
  return { source: source.slice(0, from) + prefix + source.slice(from, end), from };
}

const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

/**
 * Splits a script at top-level semicolons. Semicolons inside quotes, comments
 * and `CREATE TRIGGER ... BEGIN ... END` bodies do not end a statement. `line`
 * is where the statement's first real character sits, so errors point at code
 * rather than at a leading comment.
 *
 * PostgreSQL differs: `[` is an array subscript, not a quote; `$$...$$` and
 * `$tag$...$tag$` bodies and `E'...'` backslash escapes are quoted text; and
 * trigger bodies live in such quoted functions, so BEGIN...END is not tracked.
 */
export function splitStatements(source: string, engine: SqlEngine = "sqlite"): SqlStatement[] {
  const postgres = engine === "postgres";
  const statements: SqlStatement[] = [];
  let line = 1;
  let start = -1;
  let startLine = 1;
  const words: string[] = [];
  let triggerBody = false;
  let caseDepth = 0;

  const finish = (end: number) => {
    if (start >= 0) statements.push({ sql: source.slice(start, end), line: startLine, start, end });
    start = -1;
    words.length = 0;
    triggerBody = false;
    caseDepth = 0;
  };
  const begin = (index: number) => {
    if (start < 0) {
      start = index;
      startLine = line;
    }
  };
  const isTrigger = () =>
    words[0] === "CREATE" &&
    (words[1] === "TRIGGER" || ((words[1] === "TEMP" || words[1] === "TEMPORARY") && words[2] === "TRIGGER"));

  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
    } else if (
      postgres &&
      c === "$" &&
      /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(source.slice(i, i + 64)) &&
      !isWordChar(source[i - 1] ?? " ")
    ) {
      // Dollar quote: everything up to the same $tag$ is text, semicolons included.
      begin(i);
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i, i + 64))![0];
      const close = source.indexOf(tag, i + tag.length);
      const end = close < 0 ? source.length : close + tag.length;
      line += source.slice(i, end).split("\n").length - 1;
      i = end;
    } else if (c === "'" || c === '"' || (!postgres && (c === "`" || c === "["))) {
      begin(i);
      const close = c === "[" ? "]" : c;
      // E'...' (also e'') lets a backslash escape the quote.
      const backslash = postgres && c === "'" && /[Ee]/.test(source[i - 1] ?? "") && !isWordChar(source[i - 2] ?? " ");
      i++;
      while (i < source.length) {
        if (source[i] === "\n") line++;
        if (backslash && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === close) {
          if (close !== "]" && source[i + 1] === close) i++;
          else break;
        }
        i++;
      }
      i++;
    } else if (c === ";") {
      if (triggerBody) i++;
      else {
        finish(i);
        i++;
      }
    } else if (isWordChar(c)) {
      begin(i);
      let end = i;
      while (end < source.length && isWordChar(source[end])) end++;
      const word = source.slice(i, end).toUpperCase();
      if (words.length < 4) words.push(word);
      if (!postgres && isTrigger()) {
        if (word === "BEGIN") triggerBody = true;
        else if (triggerBody && word === "CASE") caseDepth++;
        else if (triggerBody && word === "END") {
          if (caseDepth > 0) caseDepth--;
          else triggerBody = false;
        }
      }
      i = end;
    } else {
      if (!/\s/.test(c)) begin(i);
      i++;
    }
  }
  finish(source.length);
  return statements;
}

function csvField(cell: SqlCell): string {
  if (cell === null) return "";
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** RFC 4180 row. SQL NULL becomes an empty field; CSV cannot tell it from ''. */
export const csvLine = (cells: readonly SqlCell[]) => `${cells.map(csvField).join(",")}\r\n`;

function formatCell(value: unknown): SqlCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    const hex = Array.from(value.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return `x'${hex}${value.length > 16 ? "…" : ""}'${value.length > 16 ? ` (${value.length} bytes)` : ""}`;
  }
  return String(value);
}

/** The slice of the sqlite-wasm API this module uses. */
export type SqliteApi = {
  readonly oo1: {
    readonly DB: new (
      filename: string,
      flags: string,
    ) => {
      readonly pointer: unknown;
      exec(options: {
        sql: string;
        rowMode: "array";
        columnNames: string[];
        callback: (row: unknown[]) => void;
      }): unknown;
      changes(total: boolean): number;
      close(): void;
    };
  };
  readonly capi: { sqlite3_error_offset?: (db: unknown) => number };
};

const ERROR_PREFIX = /^SQLITE_\w+: sqlite3 result code \d+: /;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function errorLine(sqlite3: SqliteApi, db: { pointer: unknown }, statement: SqlStatement): number {
  const offset = sqlite3.capi.sqlite3_error_offset?.(db.pointer) ?? -1;
  if (offset < 0) return statement.line;
  const before = decoder.decode(encoder.encode(statement.sql).slice(0, offset));
  return statement.line + (before.match(/\n/g)?.length ?? 0);
}

/**
 * Runs every statement against a fresh in-memory database, then closes it.
 * Statements that end at or before `from` run as silent setup: no result, write or count.
 */
export function executeScript(sqlite3: SqliteApi, source: string, from = 0): SqlOutcome {
  const started = performance.now();
  const statements = splitStatements(source);
  const sets: SqlResultSet[] = [];
  const writes: { line: number; rows: number }[] = [];
  let setsOmitted = 0;
  let csvBudget: number = SQL_LIMITS.csvChars;
  let error: SqlOutcome["error"];
  let ran = 0;

  const db = new sqlite3.oo1.DB(":memory:", "c");
  try {
    for (const [index, statement] of statements.entries()) {
      const columns: string[] = [];
      const rows: SqlCell[][] = [];
      let totalRows = 0;
      let csv = "";
      let csvComplete = true;
      const changedBefore = db.changes(true);
      const setup = statement.end <= from;
      try {
        db.exec({
          sql: statement.sql,
          rowMode: "array",
          columnNames: columns,
          callback: (row) => {
            if (setup) return;
            const cells = row.map(formatCell);
            totalRows++;
            if (rows.length < SQL_LIMITS.displayRows) rows.push(cells);
            if (csv === "") csv = csvLine(columns);
            const line = csvLine(cells);
            if (csvBudget >= line.length) {
              csv += line;
              csvBudget -= line.length;
            } else csvComplete = false;
          },
        });
      } catch (caught) {
        error = {
          line: errorLine(sqlite3, db, statement),
          statement: index + 1,
          message: (caught instanceof Error ? caught.message : String(caught)).replace(ERROR_PREFIX, ""),
        };
        break;
      }
      if (setup) continue;
      ran++;
      if (columns.length > 0) {
        if (csv === "") csv = csvLine(columns);
        if (sets.length < SQL_LIMITS.resultSets) {
          const explain = /^\s*EXPLAIN\s+QUERY\s+PLAN\b/i.test(statement.sql)
            ? "plan"
            : /^\s*EXPLAIN\b/i.test(statement.sql)
              ? "bytecode"
              : undefined;
          sets.push({
            line: statement.line,
            columns: [...columns],
            rows,
            totalRows,
            csv,
            csvComplete,
            ...(explain && { explain }),
          });
        } else setsOmitted++;
      } else {
        const changed = db.changes(true) - changedBefore;
        if (changed > 0) writes.push({ line: statement.line, rows: changed });
      }
    }
  } finally {
    db.close();
  }
  return { statements: ran, durationMs: Math.round(performance.now() - started), sets, setsOmitted, writes, error };
}

/** The slice of a booted PGlite instance this module uses. */
export type PgliteDb = {
  query(
    sql: string,
    params: unknown[],
    options: { rowMode: "array"; parsers: Record<number, (text: string) => unknown> },
  ): Promise<{ rows: unknown[][]; fields: { name: string }[]; affectedRows?: number }>;
};

/** Every column type keeps PostgreSQL's own text form (dates, numerics, arrays, bytea), as psql shows it. */
const PG_TEXT = new Proxy({} as Record<number, (text: string) => unknown>, { get: () => (text: string) => text });

/**
 * PostgreSQL counterpart of `executeScript`, against a fresh PGlite instance the
 * caller boots and throws away. Same limits, setup rule and outcome shape.
 */
export async function executePostgres(db: PgliteDb, source: string, from = 0): Promise<SqlOutcome> {
  const started = performance.now();
  const sets: SqlResultSet[] = [];
  const writes: { line: number; rows: number }[] = [];
  let setsOmitted = 0;
  let csvBudget: number = SQL_LIMITS.csvChars;
  let error: SqlOutcome["error"];
  let ran = 0;

  for (const [index, statement] of splitStatements(source, "postgres").entries()) {
    let result: Awaited<ReturnType<PgliteDb["query"]>>;
    try {
      result = await db.query(statement.sql, [], { rowMode: "array", parsers: PG_TEXT });
    } catch (caught) {
      const {
        message = String(caught),
        position,
        hint,
      } = caught as { message?: string; position?: string; hint?: string };
      // `position` is 1-based, in characters of the statement text.
      const before = statement.sql.slice(0, Math.max(Number(position) - 1, 0) || 0);
      error = {
        line: statement.line + (before.match(/\n/g)?.length ?? 0),
        statement: index + 1,
        message: hint ? `${message}. Hint: ${hint}` : message,
      };
      break;
    }
    if (statement.end <= from) continue;
    ran++;
    if (result.fields.length === 0) {
      if (result.affectedRows) writes.push({ line: statement.line, rows: result.affectedRows });
      continue;
    }
    if (sets.length >= SQL_LIMITS.resultSets) {
      setsOmitted++;
      continue;
    }
    const columns = result.fields.map((field) => field.name);
    let csv = csvLine(columns);
    let csvComplete = true;
    const rows = result.rows.map((row) => row.map(formatCell));
    for (const cells of rows) {
      const line = csvLine(cells);
      if (csvBudget >= line.length) {
        csv += line;
        csvBudget -= line.length;
      } else csvComplete = false;
    }
    sets.push({
      line: statement.line,
      columns,
      rows: rows.slice(0, SQL_LIMITS.displayRows),
      totalRows: rows.length,
      csv,
      csvComplete,
      ...(/^\s*EXPLAIN\b/i.test(statement.sql) && { explain: "plan" as const }),
    });
  }
  return {
    engine: "postgres",
    statements: ran,
    durationMs: Math.round(performance.now() - started),
    sets,
    setsOmitted,
    writes,
    error,
  };
}
