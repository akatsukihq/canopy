/**
 * Tool specs for tests, read from the local development database.
 *
 * Specs live only in `managed_tools.spec`, so tests load the same spec the app
 * serves. The connection is read-only and its URL is read from `.env.local` /
 * `.env` without touching `process.env`, so application code under test still
 * sees no database unless a test configures one.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const specs = new Map();
let pool;

function databaseUrl() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, "utf8")));
  }
  const url = env.DATABASE_URL;
  if (!url) throw new Error("Tool tests read specs from the dev database: set DATABASE_URL in .env.local.");
  return url;
}

function connection() {
  pool ??= new pg.Pool({
    connectionString: databaseUrl(),
    max: 1,
    allowExitOnIdle: true,
    options: "-c default_transaction_read_only=on",
  });
  return pool;
}

/** The stored spec for `tools/<definitionKey>`; fails loudly when the row has none. */
export function toolSpec(definitionKey) {
  if (!specs.has(definitionKey)) {
    specs.set(
      definitionKey,
      connection()
        .query("SELECT spec FROM managed_tools WHERE tool_id = ANY($1) AND spec IS NOT NULL", [
          [`devtools.${definitionKey}`, `media.${definitionKey}`],
        ])
        .then(({ rows }) => {
          if (rows.length !== 1) {
            throw new Error(
              `No spec for "${definitionKey}" in the dev database. Run \`pnpm db:migrate 0009-tool-spec\`.`,
            );
          }
          return rows[0].spec;
        }),
    );
  }
  return specs.get(definitionKey);
}

/** Every stored spec, for invariants that must hold across all tools. */
export async function allToolSpecs() {
  const { rows } = await connection().query("SELECT spec FROM managed_tools WHERE spec IS NOT NULL ORDER BY tool_id");
  return rows.map((row) => row.spec);
}
