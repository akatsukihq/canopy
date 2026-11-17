import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";

const usage =
  "Usage: pnpm db:migrate <folder> [--env local|process|<name>]  (<name> loads .env.<name>; process uses only the process environment; default is process when NODE_ENV=production, otherwise local)";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { env: { type: "string", default: process.env.NODE_ENV === "production" ? "process" : "local" } },
});
const [folder, ...extra] = positionals;
if (!folder || extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(folder)) throw new Error(usage);
if (!/^[a-z][a-z0-9-]*$/.test(values.env)) throw new Error(usage);
const root = new URL("../migration/", import.meta.url);
const folders = await readdir(root, { withFileTypes: true });
if (!folders.some((entry) => entry.name === folder && entry.isDirectory())) {
  throw new Error(`Unknown migration folder: ${folder}`);
}
const directory = new URL(`${folder}/`, root);
const names = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();
if (!names.length) throw new Error(`No SQL migrations in folder: ${folder}`);
const migrations = await Promise.all(
  names.map(async (name) => [name, await readFile(new URL(encodeURIComponent(name), directory), "utf8")]),
);

// Plain Node needs dotenv. Local: shell variables win over .env.local/.env.
// A named env loads only .env.<name> and wins over the shell, so a DATABASE_URL
// exported for local work can never redirect a prod run.
// `process` is for the production image, which has neither dotenv nor env files: its variables are already set.
if (values.env === "process") {
  // Nothing to load.
} else if (values.env === "local") {
  const { config: loadEnv } = await import("dotenv");
  for (const file of [".env.local", ".env"]) {
    loadEnv({ path: new URL(`../../${file}`, import.meta.url), override: false, quiet: true });
  }
} else {
  const { config: loadEnv } = await import("dotenv");
  const path = new URL(`../../.env.${values.env}`, import.meta.url);
  if (!existsSync(path)) throw new Error(`Missing env file: .env.${values.env}`);
  loadEnv({ path, override: true, quiet: true });
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`DATABASE_URL is required (env: ${values.env})`);
const target = URL.canParse(databaseUrl) ? new URL(databaseUrl) : null;
console.log(`Env ${values.env}: migrating ${target ? `${target.hostname}${target.pathname}` : "database"}`);
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 30_000 });

try {
  await client.connect();
  const cloudName = (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  await client.query("SELECT set_config('canopy.cloudinary_cloud_name', $1, false)", [cloudName]);
  for (const [name, migration] of migrations) {
    await client.query(migration);
    console.log(`Applied ${folder}/${name}`);
  }
  console.log("Restart running application instances to refresh the in-memory tool catalog.");
} finally {
  await client.end();
}
