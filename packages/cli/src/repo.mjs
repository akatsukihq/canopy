import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

export const TOOL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TOOL_APPS = ["devtools", "media"];

/** The Canopy checkout the command runs in: the nearest parent with `tools/` and `db/schema.ts`. */
export function findRepoRoot(start = process.cwd()) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "tools")) && existsSync(path.join(dir, "db/schema.ts"))) return dir;
    if (path.dirname(dir) === dir) throw new Error("Run canopy inside a Canopy checkout.");
  }
}

/** `DATABASE_URL` from the environment, else `.env.local`, else `.env`. */
export function databaseUrl(root) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    const url = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).DATABASE_URL : undefined;
    if (url) return url;
  }
  throw new Error("DATABASE_URL is not set (environment, .env.local or .env).");
}

export async function withDatabase(root, callback) {
  const client = new pg.Client({ connectionString: databaseUrl(root) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

/** The repo's category registry; it imports nothing, so Node loads the .ts directly. */
export async function loadCategories(root) {
  const file = path.join(root, "lib/tool-framework/categories.ts");
  return (await import(pathToFileURL(file).href)).TOOL_CATEGORIES;
}
