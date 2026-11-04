import type { ToolSpec } from "../../lib/tool-framework/spec";

/**
 * Type-only imports: this file loads under a plain fs walk with no bundler.
 * `maxLength` repeats SQL_LIMITS.sourceBytes (a character cap; the run adapter
 * also enforces the 64 KiB byte cap).
 */
export default {
  messages: {
    "sql.loading": "Loading SQL engine…",
    "workspace.engine": "Database engine",
    "workspace.plan.pgSummary":
      "PostgreSQL runs this query in {count, plural, one {# step} other {# steps}}. Indented steps feed the step above them.",
    "sql.summary":
      "Ran {statements, plural, one {# statement} other {# statements}} in {ms, number} ms; {queries, plural, =0 {no query returned rows} one {# query returned {rows, plural, one {# row} other {# rows}}} other {# queries returned {rows, plural, one {# row} other {# rows}} in total}}.",
    "sql.summaryWrites": "{rows, plural, one {# row was} other {# rows were}} changed by your statements.",
    "sql.summaryOmitted":
      "{count, plural, one {# more query ran} other {# more queries ran}} but only the first 20 result tables are kept.",
    "sql.stopped": "Stopped at line {line}: {message}",
    "sql.stoppedDetail":
      "{statements, plural, =0 {No statement finished before the error.} one {# statement finished before the error.} other {# statements finished before the error.}} Fix the statement on that line and run again.",
    "sql.noOutput": "No output. The script ran without returning any rows.",
    "sql.noOutputChanged":
      "No output. The script ran and {count, plural, one {# row was} other {# rows were}} changed.",
    "sql.noRows": "This query returned no rows.",
    "errors.sql-too-large": "The SQL is larger than 64 KiB.",
    "recovery.sqlTooLarge": "Remove some statements, or split the script into smaller runs.",
    "errors.sql-timeout": "The script was stopped after running for 5 seconds.",
    "recovery.sqlTimeout":
      "A query may be looping or scanning too much data. Add a LIMIT or a stopping condition, then run again. Your SQL is unchanged.",
    "errors.sql-engine-load": "The SQL engine could not be loaded.",
    "recovery.sqlEngineLoad":
      "Check your connection and press Run to try again. Your SQL is still in the editor and nothing was lost.",
    "workspace.results": "SQL results",
    "workspace.tables": "Result tables",
    "workspace.table": "Result {n}, line {line}",
    "workspace.showing":
      "Showing the first {shown, number} of {total, number} rows. The CSV download includes {csvRows}.",
    "workspace.csvAll": "every row",
    "workspace.csvPartial": "the first rows only (the CSV size limit was reached)",
    "workspace.rowCount": "{count, plural, one {# row} other {# rows}}",
    "workspace.downloadCsv": "Download CSV",
    "workspace.nullHint": "NULL means no value; an empty string is shown as a blank cell.",
    "workspace.nullCell": "NULL",
    "workspace.runStatement": "Run this statement",
    "workspace.runSelection": "Run selection",
    "workspace.runAll": "Run all",
    "workspace.explain": "Explain (bytecode)",
    "workspace.explainPlan": "Explain query plan",
    "workspace.plan.summary":
      "SQLite runs this query in {count, plural, one {# step} other {# steps}}, from top to bottom.",
    "workspace.plan.scan": "Reads every row of {target}, one by one. Quick on small tables, slow on big ones.",
    "workspace.plan.search": "Jumps straight to the matching rows of {target} using an index or the primary key.",
    "workspace.plan.temp":
      "{clause, select, ORDER {Builds a temporary sorted list to put the rows in order.} GROUP {Builds a temporary list to group the rows.} DISTINCT {Builds a temporary list to remove duplicate rows.} other {Builds a temporary list to process the rows.}}",
    "workspace.explainBytecodeHelp":
      "These are the low-level steps SQLite runs for this statement, one per line. Each line is an operation (opcode) with its operands (p1 to p5). Use Explain query plan for a plain summary.",
    "workspace.cut": "Cut",
    "workspace.copy": "Copy",
    "workspace.paste": "Paste",
    "workspace.selectAll": "Select all",
    "workspace.info.statements": "Statements",
    "workspace.info.time": "Run time",
    "workspace.info.returned": "Rows returned",
    "workspace.info.changed": "Rows changed",
    "workspace.info.ms": "{ms, number} ms",
    "workspace.writes": "Changes",
    "workspace.writeLine": "Line {line}: {rows, plural, one {# row changed} other {# rows changed}}",
  },
  toolId: "devtools.sql-compiler",
  app: "devtools",
  category: "compilers",
  keywords: [
    "sql",
    "sqlite",
    "postgresql",
    "postgres",
    "online sql",
    "sql compiler",
    "sql playground",
    "run sql",
    "postgres online compiler",
  ],
  name: "SQL Compiler",
  description: "Run SQLite or PostgreSQL queries in your browser and see the results as tables.",
  input: {
    kind: "text",
    language: "sql",
    label: "SQL",
    showLineNumbers: true,
    maxLength: 65_536,
    placeholder: "CREATE TABLE ...; INSERT ...; SELECT ...;",
    acceptFiles: { accept: ".sql,.txt,text/plain", maxBytes: 65_536 },
  },
  settings: {
    fields: {
      engine: {
        kind: "select",
        label: "Database engine",
        help: "SQLite starts instantly. PostgreSQL is a real PostgreSQL 18 server: a one-time download of several megabytes that your browser keeps.",
        default: "sqlite",
        choices: [
          { value: "sqlite", label: "SQLite 3.54" },
          { value: "postgres", label: "PostgreSQL 18" },
        ],
      },
    },
  },
  trigger: { mode: "manual", actionLabel: "Run" },
  capabilities: { cancel: true, progress: true },
  workbenchMark: { text: "SQL", tone: "contrast" },
  labels: {
    result: "Results",
    empty: "Press Run to execute your SQL and see the results here.",
    ready: "Results are ready.",
    running: "Running SQL…",
  },
  content: {
    howToUse: [
      "Pick SQLite or PostgreSQL next to the file name, then write statements in the editor. The starter creates a table, adds rows and selects them on both engines, so you can press Run straight away.",
      "Press Run or Ctrl/Cmd+Enter. Every statement runs in order against a fresh, empty in-memory database.",
      "Read the sentence at the top of the results, then open a result table for each query. Writes list how many rows they changed.",
      "If a statement fails, the message names the line. Earlier results stay visible.",
    ],
    limitations: [
      "Choose the engine your SQL is written for: SQLite or PostgreSQL 18. MySQL, SQL Server and Oracle syntax may fail on both.",
      "PostgreSQL is downloaded the first time you pick it (several megabytes) and takes a few seconds to start; your browser keeps the download for later visits.",
      "Nothing is saved: each run starts with an empty database and your tables disappear afterwards.",
      "SQL is limited to 64 KiB, 1,000 rows are shown per result table and at most 20 result tables are kept.",
      "A run is stopped after 5 seconds. The CSV download holds every row of a result table, within a size limit.",
    ],
    faq: [
      {
        q: "Is my SQL sent to a server?",
        a: "No. SQLite and PostgreSQL both run inside your browser tab as WebAssembly. Your SQL and results never leave your device.",
      },
      {
        q: "Which PostgreSQL version runs, and is it real PostgreSQL?",
        a: "PostgreSQL 18, compiled to WebAssembly (PGlite). It is the real database server, so features such as SERIAL, ILIKE, JSONB, arrays, CTEs and PL/pgSQL functions work. Extensions that need a separate install are not available.",
      },
      {
        q: "Why does my query work on one engine but not the other?",
        a: "SQLite and PostgreSQL speak different SQL dialects. For example SERIAL, ILIKE and :: casts are PostgreSQL only, while AUTOINCREMENT and square-bracket names are SQLite only. Switch the engine to the one your SQL is written for.",
      },
      {
        q: "Will my tables still be there next time?",
        a: "No. Each run opens a new empty in-memory database, so put the CREATE TABLE and INSERT statements in the same script.",
      },
    ],
    examples: [
      {
        label: "Starter",
        text: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, city TEXT);\nINSERT INTO users (id, name, city) VALUES (1, 'Ada', 'London'), (2, 'Grace', NULL), (3, 'Linus', '');\nSELECT id, name, city FROM users ORDER BY name;\nSELECT count(*) AS people FROM users;\n",
      },
    ],
  },
} as const satisfies ToolSpec;
