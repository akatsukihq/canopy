/**
 * Adapter between the tool framework and the SQL engine workers. It runs on the
 * main thread (`run.ts`) so its spare workers outlive a run; the framework's own
 * worker is created and terminated per run and would take them down with it.
 * A runaway query needs a worker that can be terminated, so every run gets its
 * own engine worker (and a fresh database) and always terminates it.
 */
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { EngineMessage } from "./engine.worker.ts";
import { SQL_LIMITS, parseScope, toEngine, type SqlEngine, type SqlOutcome } from "./script.ts";

/** What the adapter needs from a Worker, so tests can supply a Node one. */
export type Engine = {
  postMessage(message: { source: string; from?: number }): void;
  terminate(): void;
  onmessage: ((event: { data: EngineMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/** Covers the first PostgreSQL download (5-10 MB) plus its boot on a slow connection. */
const LOAD_LIMIT_MS = 60_000;

const loadError = () =>
  new ToolError("sql-engine-load", "The SQL engine could not be loaded.", "Press Run to try again.", {
    recoveryMessage: { key: "recovery.sqlEngineLoad" },
  });

export function runInEngine(
  engine: Engine,
  source: string,
  signal: AbortSignal,
  onLoading: () => void,
  runMs: number = SQL_LIMITS.runMs,
  from = 0,
): Promise<SqlOutcome> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      engine.terminate();
      settle();
    };
    const fail = (error: unknown) => finish(() => reject(error));
    const onAbort = () => fail(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => fail(loadError()), LOAD_LIMIT_MS);
    engine.onerror = () => fail(loadError());
    engine.onmessage = ({ data }) => {
      if (data.type === "loading") onLoading();
      else if (data.type === "load-error") fail(loadError());
      else if (data.type === "running") {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            fail(
              new ToolError(
                "sql-timeout",
                "The script was stopped after running for 5 seconds.",
                "Add a LIMIT or a stopping condition, then run again.",
                { recoveryMessage: { key: "recovery.sqlTimeout" } },
              ),
            ),
          runMs,
        );
      } else finish(() => resolve(data.outcome));
    };
    engine.postMessage({ source, from });
  });
}

export function toResult(outcome: SqlOutcome): ToolResult {
  const queries = outcome.sets.length + outcome.setsOmitted;
  const rows = outcome.sets.reduce((sum, set) => sum + set.totalRows, 0);
  const { statements, durationMs: ms, error } = outcome;
  const text = error
    ? `Stopped at line ${error.line}: ${error.message}`
    : `Ran ${statements} statement${statements === 1 ? "" : "s"} in ${ms} ms; ${queries} ${queries === 1 ? "query" : "queries"} returned ${rows} ${rows === 1 ? "row" : "rows"}.`;
  return {
    render: "json-tree",
    text,
    value: outcome,
    verdict: error
      ? {
          level: "error",
          label: text,
          labelMessage: { key: "sql.stopped", values: { line: error.line, message: error.message } },
          detailMessage: { key: "sql.stoppedDetail", values: { statements } },
        }
      : { level: "ok", label: text, labelMessage: { key: "sql.summary", values: { statements, ms, queries, rows } } },
  };
}

const spawn = (engine: SqlEngine) =>
  new Worker(new URL("./engine.worker.ts", import.meta.url), {
    name: engine === "postgres" ? "canopy-sql-postgres" : "canopy-sql-engine",
  });

/**
 * An engine worker loads its engine as soon as it exists (PGlite takes seconds).
 * Each run takes the ready spare and starts the next one, so runs skip the load
 * while every run still gets a fresh, empty database.
 * ponytail: one idle engine per used engine stays in memory (PGlite ~100 MB).
 */
const spares: Partial<Record<SqlEngine, Worker>> = {};

/** Starts loading an engine before the first run; the workspace calls it when the engine is chosen. */
export function prewarm(engine: SqlEngine): void {
  spares[engine] ??= spawn(engine);
}

function take(engine: SqlEngine): Worker {
  const ready = spares[engine] ?? spawn(engine);
  spares[engine] = spawn(engine);
  return ready;
}

const run: ToolRun<{ engine?: unknown }> = async (ctx) => {
  if (new TextEncoder().encode(ctx.input.text).length > SQL_LIMITS.sourceBytes) {
    throw new ToolError("sql-too-large", "The SQL is larger than 64 KiB.", "Split the script into smaller runs.", {
      recoveryMessage: { key: "recovery.sqlTooLarge" },
    });
  }
  const kind = toEngine(ctx.settings.engine);
  const engine = take(kind);
  const scoped = parseScope(ctx.input.text, ctx.input.secondary, kind);
  const outcome = await runInEngine(
    engine as unknown as Engine,
    scoped.source,
    ctx.signal,
    () => ctx.progress({ completed: 0, total: 1, stage: "Loading SQL engine…", stageMessage: { key: "sql.loading" } }),
    SQL_LIMITS.runMs,
    scoped.from,
  );
  return toResult(outcome);
};

export default run;
