/**
 * The dedicated SQL engine worker. One per run: run.ts terminates it on Cancel
 * or after the 5 s limit, which is the only way to stop a query that never
 * returns. Engines load from our own origin, never a CDN.
 *
 * The engine loads as soon as the worker exists (PostgreSQL when it is named
 * `canopy-sql-postgres`, SQLite otherwise): run.ts keeps one spare loading in
 * the background so the next run finds it ready.
 */
import {
  PGLITE_VENDOR_URL,
  SQLITE_VENDOR_URL,
  executePostgres,
  executeScript,
  type PgliteDb,
  type SqlOutcome,
  type SqliteApi,
} from "./script.ts";

export type EngineMessage =
  | { readonly type: "loading" }
  | { readonly type: "running" }
  | { readonly type: "done"; readonly outcome: SqlOutcome }
  | { readonly type: "load-error" };

type Scope = {
  name: string;
  onmessage: ((event: MessageEvent<{ source: string; from?: number }>) => void) | null;
  postMessage(message: EngineMessage): void;
  location: Location;
};
const scope = globalThis as unknown as Scope;

const load = <T>(url: string): Promise<T> =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL(url, scope.location.origin).href) as Promise<T>;

type Ready = { kind: "postgres"; db: PgliteDb } | { kind: "sqlite"; sqlite3: SqliteApi };
const ready: Promise<Ready> =
  scope.name === "canopy-sql-postgres"
    ? load<{ PGlite: { create(): Promise<PgliteDb> } }>(`${PGLITE_VENDOR_URL}/index.js`)
        .then(({ PGlite }) => PGlite.create())
        .then((db) => ({ kind: "postgres", db }))
    : load<{ default: () => Promise<SqliteApi> }>(`${SQLITE_VENDOR_URL}/index.mjs`)
        .then((module) => module.default())
        .then((sqlite3) => ({ kind: "sqlite", sqlite3 }));
// Reported on Run, not here: an unhandled rejection would surface before anyone asked.
ready.catch(() => undefined);

scope.onmessage = async (event) => {
  const { source, from } = event.data;
  scope.postMessage({ type: "loading" });
  let engine: Ready;
  try {
    engine = await ready;
  } catch {
    scope.postMessage({ type: "load-error" });
    return;
  }
  scope.postMessage({ type: "running" });
  const outcome =
    engine.kind === "postgres"
      ? await executePostgres(engine.db, source, from)
      : executeScript(engine.sqlite3, source, from);
  scope.postMessage({ type: "done", outcome });
};
