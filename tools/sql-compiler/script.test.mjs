import { readFileSync, existsSync } from "node:fs";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { beforeAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  PGLITE_VERSION,
  SQLITE_VERSION,
  SQL_LIMITS,
  csvLine,
  executePostgres,
  executeScript,
  parseScope,
  splitStatements,
} from "./script.ts";

let sqlite3;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

test("splits on top-level semicolons and tracks the line of each statement", () => {
  const out = splitStatements("-- hi\nSELECT 1;\n\n  /* c */ SELECT 2\n;SELECT 3");
  expect(out.map((s) => [s.sql.trim(), s.line])).toEqual([
    ["SELECT 1", 2],
    ["SELECT 2", 4],
    ["SELECT 3", 5],
  ]);
});

test("semicolons in strings, quoted identifiers and comments do not split", () => {
  const out = splitStatements(`SELECT 'a;b''c;', "x;y", [p;q], \`r;s\` -- no;pe\n/* ; */;SELECT 2`);
  expect(out).toHaveLength(2);
  expect(out[1].sql).toBe("SELECT 2");
});

test("trigger bodies, including CASE ... END, stay in one statement", () => {
  const sql = `CREATE TABLE t(a);
CREATE TRIGGER trg AFTER INSERT ON t BEGIN
  UPDATE t SET a = CASE WHEN a > 1 THEN 1 ELSE 2 END;
  DELETE FROM t WHERE a = 0;
END;
INSERT INTO t VALUES (1);`;
  const out = splitStatements(sql);
  expect(out.map((s) => s.line)).toEqual([1, 2, 6]);
  expect(out[1].sql.endsWith("END")).toBe(true);
});

test("runs statements, reports rows, NULL vs empty string and changes", () => {
  const r = executeScript(sqlite3, "CREATE TABLE t(a,b);\nINSERT INTO t VALUES (1,NULL),(2,'');\nSELECT * FROM t;");
  expect(r.error).toBeUndefined();
  expect(r.statements).toBe(3);
  expect(r.writes).toEqual([{ line: 2, rows: 2 }]);
  expect(r.sets[0].columns).toEqual(["a", "b"]);
  expect(r.sets[0].rows).toEqual([
    ["1", null],
    ["2", ""],
  ]);
  expect(r.sets[0].csv).toBe("a,b\r\n1,\r\n2,\r\n");
});

test("a query with no rows still has its columns", () => {
  const r = executeScript(sqlite3, "SELECT 1 AS x WHERE 0;");
  expect(r.sets[0]).toMatchObject({ columns: ["x"], totalRows: 0 });
});

test("errors carry the statement line and stop the script, keeping earlier results", () => {
  const r = executeScript(sqlite3, "SELECT 1;\n\nSELECT 2;\nselec 3;\nSELECT 4;");
  expect(r.error).toMatchObject({ line: 4, statement: 3 });
  expect(r.error.message).toMatch(/syntax error/);
  expect(r.sets).toHaveLength(2);
});

test("a multi-line statement reports the line inside it", () => {
  const r = executeScript(sqlite3, "SELECT\n  1,\n  FROM FROM x;");
  expect(r.error.line).toBe(3);
});

test("display is capped at 1,000 rows, totals and CSV keep every row", () => {
  const r = executeScript(
    sqlite3,
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2500) SELECT x FROM c;",
  );
  expect(r.sets[0].rows).toHaveLength(SQL_LIMITS.displayRows);
  expect(r.sets[0].totalRows).toBe(2500);
  expect(r.sets[0].csv.split("\r\n")).toHaveLength(2502);
  expect(r.sets[0].csvComplete).toBe(true);
});

test("keeps at most 20 result sets and counts the rest", () => {
  const r = executeScript(sqlite3, "SELECT 1;".repeat(23));
  expect(r.sets).toHaveLength(SQL_LIMITS.resultSets);
  expect(r.setsOmitted).toBe(3);
});

test("each run starts from an empty database", () => {
  executeScript(sqlite3, "CREATE TABLE t(a);");
  expect(executeScript(sqlite3, "SELECT * FROM t;").error.message).toMatch(/no such table/);
});

test("CSV quotes commas, quotes and newlines", () => {
  expect(csvLine(["a,b", 'say "hi"', "x\ny", null, ""])).toBe('"a,b","say ""hi""","x\ny",,\r\n');
});

test("the vendored folder matches the pinned package version", () => {
  const pkg = JSON.parse(readFileSync("node_modules/@sqlite.org/sqlite-wasm/package.json", "utf8"));
  expect(pkg.version).toBe(SQLITE_VERSION);
  expect(existsSync(`public/code/vendor/sqlite/${SQLITE_VERSION}/sqlite3.wasm`)).toBe(true);
});

test("a scoped run runs earlier statements as silent setup and reports only its own", () => {
  const sql = "CREATE TABLE t(a);\nINSERT INTO t VALUES (1),(2);\nSELECT * FROM t;\nSELECT 99;";
  const insert = splitStatements(sql)[1];
  const select = splitStatements(sql)[2];

  const onlySelect = parseScope(sql, `${select.start}:${select.end}`);
  expect(onlySelect.source.endsWith("SELECT * FROM t")).toBe(true);
  const r = executeScript(sqlite3, onlySelect.source, onlySelect.from);
  expect(r.error).toBeUndefined();
  expect(r.statements).toBe(1);
  expect(r.writes).toEqual([]);
  expect(r.sets).toHaveLength(1);
  expect(r.sets[0].line).toBe(3);
  expect(r.sets[0].rows).toEqual([["1"], ["2"]]);

  const onlyInsert = parseScope(sql, `${insert.start}:${insert.end}`);
  const w = executeScript(sqlite3, onlyInsert.source, onlyInsert.from);
  expect(w.writes).toEqual([{ line: 2, rows: 2 }]);
  expect(w.sets).toHaveLength(0);

  expect(parseScope(sql, "")).toEqual({ source: sql, from: 0 });
  expect(parseScope(sql, "5:5")).toEqual({ source: sql, from: 0 });
});

test("PostgreSQL splitting keeps dollar-quoted bodies, E'' escapes and array brackets together", () => {
  const sql = `CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
DO $body$ BEGIN PERFORM 1; END $body$;
SELECT E'a\\';b', ARRAY[1,2][1];
SELECT 4`;
  const out = splitStatements(sql, "postgres");
  expect(out.map((s) => s.line)).toEqual([1, 2, 3, 4]);
  expect(out[2].sql).toBe("SELECT E'a\\';b', ARRAY[1,2][1]");
});

test("the vendored PGlite folder matches the pinned package version", () => {
  const { version } = JSON.parse(readFileSync("node_modules/@electric-sql/pglite/package.json", "utf8"));
  expect(PGLITE_VERSION).toBe(version);
});

test("PostgreSQL runs return text values, writes, plans and positioned errors", { timeout: 60_000 }, async () => {
  const db = await PGlite.create();
  const ok = await executePostgres(
    db,
    "CREATE TABLE t (id int, name text);\nINSERT INTO t VALUES (1, 'a'), (2, NULL);\nSELECT id, name, now() IS NOT NULL AS live FROM t ORDER BY id;\nEXPLAIN SELECT * FROM t",
  );
  expect(ok.engine).toBe("postgres");
  expect(ok.error).toBeUndefined();
  expect(ok.writes).toEqual([{ line: 2, rows: 2 }]);
  expect(ok.sets[0].rows).toEqual([
    ["1", "a", "true"],
    ["2", null, "true"],
  ]);
  expect(ok.sets[1].explain).toBe("plan");
  expect(ok.sets[1].columns).toEqual(["QUERY PLAN"]);

  const bad = await executePostgres(db, "SELECT 1;\nSELECT\n  nope FROM t");
  expect(bad.error).toMatchObject({ line: 3, statement: 2 });
  expect(bad.error.message).toMatch(/nope/);
  await db.close();
});
