import { mkdir, readFile, readdir, stat, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import config from "../../lib/config/config.ts";
import { isLocale } from "../../lib/i18n/config.ts";
import { validateToolTranslation } from "../../lib/tool-framework/translations.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const paperworkFolders = {
  "invoice-generator": "",
  "receipt-generator": "receipt",
  "expense-report": "expense",
  "mileage-log": "mileage",
  "quarterly-tax-estimator": "tax",
  "w9-request": "w9",
  "1099-nec-tracker": "nec1099",
};
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function assertToolId(toolId) {
  if (typeof toolId !== "string" || !/^(devtools|media|paperwork)\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(toolId)) {
    throw new Error(`Invalid stable tool ID: ${String(toolId)}`);
  }
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Snapshot ownership follows the implementation; metadata-only tools stay in seed data. */
export async function snapshotPath(toolId, root = repositoryRoot) {
  assertToolId(toolId);
  const [app, key] = toolId.split(".");
  if (app === "paperwork" && Object.hasOwn(paperworkFolders, key)) {
    return path.resolve(root, "app/paperwork/components", paperworkFolders[key], "translations.json");
  }
  if (app !== "paperwork") {
    const definitionFile = path.resolve(root, "tools", key, "definition.ts");
    if (await exists(definitionFile)) {
      const { default: definition } = await import(pathToFileURL(definitionFile).href);
      if (definition?.toolId !== toolId) {
        throw new Error(`${toolId}: tools/${key}/definition.ts belongs to ${definition?.toolId ?? "another tool"}.`);
      }
      return path.resolve(root, "tools", key, "translations.json");
    }
  }
  return path.resolve(root, "db/seed-data/tool-translations", toolId, "translations.json");
}

/** Validate the unchanged flat database message contract, including drafts. */
export function validateSnapshot(snapshot) {
  const issues = [];
  if (!isRecord(snapshot)) return ["Snapshot must be an object."];
  try {
    assertToolId(snapshot.toolId);
  } catch (error) {
    issues.push(error.message);
  }
  if (Object.keys(snapshot).some((key) => !["toolId", "translations"].includes(key))) {
    issues.push("Snapshot may contain only toolId and translations.");
  }
  const translations = snapshot.translations;
  if (!isRecord(translations)) return [...issues, "Translations must be an object."];
  const english = translations.en?.messages;
  if (!isRecord(english) || !Object.keys(english).length) {
    return [...issues, "English source messages are required."];
  }
  for (const [locale, translation] of Object.entries(translations)) {
    if (!isLocale(locale)) {
      issues.push(`${locale}: Unsupported language.`);
      continue;
    }
    if (
      !isRecord(translation) ||
      !["draft", "published"].includes(translation.status) ||
      Object.keys(translation).some((key) => !["status", "messages"].includes(key))
    ) {
      issues.push(`${locale}: Expected status (draft or published) and messages.`);
      continue;
    }
    const messages = translation.messages;
    if (isRecord(messages)) {
      const keys = new Set(Object.keys(messages));
      for (const key of keys) {
        const parts = key.split(".");
        for (let length = 1; length < parts.length; length++) {
          if (keys.has(parts.slice(0, length).join("."))) {
            issues.push(`${locale}.${key}: Message key conflicts with a parent key.`);
            break;
          }
        }
      }
    }
    for (const issue of validateToolTranslation(locale, messages, english, {
      publish: translation.status === "published",
    })) {
      issues.push(`${locale}.${issue.key}: ${issue.message}`);
    }
  }
  return issues;
}

function assertSnapshots(snapshots) {
  const ids = new Set();
  for (const snapshot of snapshots) {
    const issues = validateSnapshot(snapshot);
    if (issues.length) throw new Error(`${snapshot?.toolId ?? "Snapshot"}:\n${issues.join("\n")}`);
    if (ids.has(snapshot.toolId))
      throw new Error(`Duplicate snapshot for ${snapshot.toolId}. Keep only its current owner folder.`);
    ids.add(snapshot.toolId);
  }
}

async function childFolders(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readSnapshots({ root = repositoryRoot, toolId } = {}) {
  if (toolId) assertToolId(toolId);
  const folders = [
    ...(await childFolders(path.join(root, "tools"))),
    ...Object.values(paperworkFolders).map((folder) => path.join(root, "app/paperwork/components", folder)),
    ...(await childFolders(path.join(root, "db/seed-data/tool-translations"))),
  ];
  const snapshots = [];
  for (const folder of folders.sort()) {
    const file = path.join(folder, "translations.json");
    if (!(await exists(file))) continue;
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    if (toolId && snapshot.toolId !== toolId) continue;
    assertSnapshots([snapshot]);
    const expected = await snapshotPath(snapshot.toolId, root);
    if (path.resolve(file) !== expected) {
      throw new Error(
        `${file}: ${snapshot.toolId} belongs at ${expected}. Move the snapshot to its current owner folder.`,
      );
    }
    snapshots.push(snapshot);
  }
  if (!snapshots.length) throw new Error(`No translation snapshots found${toolId ? ` for ${toolId}` : ""}.`);
  assertSnapshots(snapshots);
  return snapshots;
}

/** Preserve every existing locale, including drafts and administrator edits. */
export function planImport(snapshots, rows, { force = false } = {}) {
  assertSnapshots(snapshots);
  const records = new Map(rows.map((row) => [row.tool_id, row]));
  const result = { updates: [], missing: [], preserved: [], unchanged: [] };
  const mismatches = [];
  for (const snapshot of snapshots) {
    const row = records.get(snapshot.toolId);
    if (!row) {
      result.missing.push(snapshot.toolId);
      continue;
    }
    if (!force && !isDeepStrictEqual(row.translations?.en?.messages, snapshot.translations.en.messages)) {
      mismatches.push(snapshot.toolId);
      continue;
    }
    const translations = { ...row.translations };
    const addedLocales = [];
    for (const [locale, translation] of Object.entries(snapshot.translations)) {
      if (Object.hasOwn(translations, locale)) {
        if (!isDeepStrictEqual(translations[locale], translation)) {
          // --force: snapshot wins over the database copy of this locale.
          if (force) {
            translations[locale] = translation;
            addedLocales.push(locale);
          } else result.preserved.push({ toolId: snapshot.toolId, locale });
        }
      } else {
        translations[locale] = translation;
        addedLocales.push(locale);
      }
    }
    if (addedLocales.length) result.updates.push({ toolId: snapshot.toolId, translations, addedLocales });
    else result.unchanged.push(snapshot.toolId);
  }
  if (mismatches.length) {
    throw new Error(
      `English source differs or is missing for: ${mismatches.join(", ")}. No translations were imported. Reconcile the English source first; --tool can select a matching tool.`,
    );
  }
  return result;
}

export async function importSnapshots(client, snapshots, { apply = false, force = false } = {}) {
  assertSnapshots(snapshots);
  const toolIds = snapshots.map((snapshot) => snapshot.toolId).sort();
  let transaction = false;
  try {
    if (apply) {
      await client.query("BEGIN");
      transaction = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
    }
    const { rows } = await client.query(
      `SELECT tool_id, translations FROM managed_tools WHERE tool_id = ANY($1::text[]) ORDER BY tool_id${apply ? " FOR UPDATE" : ""}`,
      [toolIds],
    );
    const plan = planImport(snapshots, rows, { force });
    if (apply) {
      for (const update of plan.updates) {
        const result = await client.query(
          "UPDATE managed_tools SET translations = $1::jsonb, updated_at = now() WHERE tool_id = $2",
          [JSON.stringify(update.translations), update.toolId],
        );
        if (result.rowCount !== 1) throw new Error(`Could not update ${update.toolId}; rolling back all changes.`);
      }
      await client.query("COMMIT");
      transaction = false;
    }
    return {
      mode: apply ? "applied" : "dry-run",
      tools: snapshots.length,
      updates: plan.updates.map(({ toolId, addedLocales }) => ({ toolId, addedLocales })),
      missing: plan.missing,
      preserved: plan.preserved,
      unchanged: plan.unchanged,
    };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  let toolId;
  let apply = false;
  let force = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--apply" && !apply) apply = true;
    else if (args[index] === "--force" && !force) force = true;
    else if (args[index] === "--tool" && !toolId && args[index + 1]) toolId = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  if (!["export", "validate", "import"].includes(mode) || ((apply || force) && mode !== "import")) {
    throw new Error(
      "Usage: pnpm db:translations export|validate|import [--tool <stable-tool-id>] [--apply (import only)] [--force (import only: overwrite existing locales and English source from snapshots)]",
    );
  }
  if (toolId) assertToolId(toolId);
  const snapshots = mode === "export" ? null : await readSnapshots({ toolId });
  if (mode === "validate") {
    console.log(`Validated ${snapshots.length} translation snapshots.`);
    return;
  }
  for (const file of [".env.local", ".env"]) {
    loadEnv({ path: path.join(repositoryRoot, file), override: false, quiet: true });
  }
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 30_000 });
  try {
    await client.connect();
    if (mode === "import") {
      console.log(JSON.stringify(await importSnapshots(client, snapshots, { apply, force }), null, 2));
      return;
    }
    const { rows } = await client.query(
      `SELECT tool_id, translations FROM managed_tools${toolId ? " WHERE tool_id = $1" : ""} ORDER BY tool_id`,
      toolId ? [toolId] : [],
    );
    if (!rows.length) throw new Error(`No managed tools found${toolId ? ` for ${toolId}` : ""}.`);
    const exported = rows.map((row) => ({ toolId: row.tool_id, translations: row.translations }));
    assertSnapshots(exported);
    const destinations = await Promise.all(exported.map((snapshot) => snapshotPath(snapshot.toolId)));
    for (let index = 0; index < exported.length; index++) {
      const destination = destinations[index];
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(exported[index], null, 2)}\n`);
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    console.log(
      `Exported ${exported.length} tool translation snapshots. Runtime translations still come from the database.`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(config.databaseUrl ? message.replaceAll(config.databaseUrl, "[redacted]") : message);
    process.exitCode = 1;
  });
}
