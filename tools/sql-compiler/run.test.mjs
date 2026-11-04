import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";
import { runInEngine, toResult } from "./run.ts";

const SQLITE = pathToFileURL("node_modules/@sqlite.org/sqlite-wasm/dist/node.mjs").href;
const SCRIPT = pathToFileURL("tools/sql-compiler/script.ts").href;

/** A real thread running the real engine, shaped like the browser Worker. */
function nodeEngine() {
  const worker = new Worker(
    `const { parentPort, workerData: w } = require("node:worker_threads");
     parentPort.on("message", async ({ source }) => {
       parentPort.postMessage({ type: "loading" });
       const sqlite3 = await (await import(w.sqlite)).default();
       parentPort.postMessage({ type: "running" });
       parentPort.postMessage({ type: "done", outcome: (await import(w.script)).executeScript(sqlite3, source) });
     });`,
    { eval: true, workerData: { sqlite: SQLITE, script: SCRIPT } },
  );
  const engine = {
    onmessage: null,
    onerror: null,
    postMessage: (m) => worker.postMessage(m),
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => engine.onmessage?.({ data }));
  const exited = new Promise((resolve) => worker.on("exit", resolve));
  return { engine, exited };
}

const never = new AbortController().signal;

test("runs a script in the engine and builds a plain-language result", async () => {
  const { engine, exited } = nodeEngine();
  let loading = 0;
  const outcome = await runInEngine(
    engine,
    "CREATE TABLE t(a); INSERT INTO t VALUES (1),(2); SELECT * FROM t;",
    never,
    () => loading++,
  );
  expect(loading).toBe(1);
  const result = toResult(outcome);
  expect(result.verdict.label).toBe("Ran 3 statements in " + outcome.durationMs + " ms; 1 query returned 2 rows.");
  await exited;
});

test("a runaway recursive CTE is stopped by terminating the worker", async () => {
  const { engine, exited } = nodeEngine();
  const started = Date.now();
  await expect(
    runInEngine(
      engine,
      "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c;",
      never,
      () => {},
      400,
    ),
  ).rejects.toMatchObject({ code: "sql-timeout" });
  expect(Date.now() - started).toBeLessThan(3000);
  expect(await exited).toBeDefined(); // the thread really ended
});

test("cancelling terminates the worker and rejects as an abort", async () => {
  const { engine, exited } = nodeEngine();
  const controller = new AbortController();
  const pending = runInEngine(
    engine,
    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c;",
    controller.signal,
    () => {},
  );
  setTimeout(() => controller.abort(), 300);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await exited;
});

test("an SQL error becomes an error verdict with the line number", async () => {
  const { engine } = nodeEngine();
  const result = toResult(await runInEngine(engine, "SELECT 1;\nselec 2;", never, () => {}));
  expect(result.verdict).toMatchObject({ level: "error" });
  expect(result.verdict.label).toMatch(/^Stopped at line 2: near "selec": syntax error/);
});

test("a worker that fails to start reports a recoverable load error", async () => {
  const engine = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage() {
      queueMicrotask(() => engine.onmessage({ data: { type: "load-error" } }));
    },
  };
  await expect(runInEngine(engine, "SELECT 1", never, () => {})).rejects.toMatchObject({ code: "sql-engine-load" });
});
