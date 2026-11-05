import { afterAll, beforeAll, expect, test, vi } from "vitest";

// The migrate/seed scripts are re-imported per case; vi.mock persists across
// vi.resetModules(). Shared fixtures live on globalThis so the (hoisted) mock
// factories can reach them at call time.
vi.mock("pg", () => ({
  default: {
    Client: class Client {
      constructor() {
        return globalThis.__migrationSeedClient;
      }
    },
  },
}));
vi.mock("@/lib/cache/index.ts", () => {
  class Cache {
    constructor(namespace) {
      this.namespace = namespace;
    }
    async delete(key) {
      globalThis.__migrationSeedState.deleted.push(this.namespace + ":" + key);
    }
  }
  return { CACHE_NAMESPACES: { CATALOG: "catalog", ECOSYSTEM: "ecosystem" }, Cache, closeRedis: () => {} };
});
vi.mock("dotenv", () => ({ config: () => {} }));
vi.mock("node:fs/promises", () => ({
  readFile: (...args) => globalThis.__migrationFiles.readFile(...args),
  readdir: (...args) => globalThis.__migrationFiles.readdir(...args),
}));

const MIGRATE = "@/db/scripts/migrate.mjs";
const SEED = "@/db/scripts/seed.mjs";
let previousUrl;
let previousArgv;
let state;

const folders = {
  "0001-baseline": { "002.sql": "BASELINE TWO", "001.sql": "BASELINE ONE" },
  "0002-tool-icon-url": { "002.sql": "ICON TWO", "001.sql": "ICON ONE", "README.md": "ignore" },
  empty: {},
};
const entry = (name, directory = false) => ({ name, isDirectory: () => directory, isFile: () => !directory });

beforeAll(() => {
  previousUrl = process.env.DATABASE_URL;
  previousArgv = process.argv;
  process.env.DATABASE_URL = "postgres://test:test@localhost:1/test";
  globalThis.__migrationFiles = {
    readdir: async (url) => {
      const folder = new URL(url).pathname.split("/").filter(Boolean).at(-1);
      return folder === "migration"
        ? [...Object.keys(folders).map((name) => entry(name, true)), entry("outside-link")]
        : [...Object.keys(folders[folder]).map((name) => entry(name)), entry("nested.sql", true)];
    },
    readFile: async (url) => {
      const [folder, name] = new URL(url).pathname.split("/").slice(-2);
      return folders[folder][name];
    },
  };
});

afterAll(() => {
  delete globalThis.__migrationSeedClient;
  delete globalThis.__migrationSeedState;
  delete globalThis.__migrationFiles;
  process.argv = previousArgv;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

async function run(
  name,
  count = 0,
  failure = null,
  args = ["0001-baseline"],
  migrationFailure = null,
  script = MIGRATE,
) {
  process.argv = [...previousArgv.slice(0, 2), ...args];
  state = {
    rows: [],
    migrations: [],
    connected: false,
    closed: false,
    transactions: [],
    deleted: [],
    cloudName: undefined,
  };
  globalThis.__migrationSeedState = state;
  globalThis.__migrationSeedClient = {
    async connect() {
      state.connected = true;
    },
    async query(query, values = []) {
      expect(state.connected).toBe(true);
      const text = typeof query === "string" ? query : query.text;
      const command = text.trim().toLowerCase();
      if (["begin", "commit", "rollback"].includes(command)) {
        state.transactions.push(command);
        return { rows: [] };
      }
      if (text.includes("set_config")) {
        state.cloudName = values[0];
        return { rows: [] };
      }
      if (text.includes("SELECT COUNT(*)")) return { rows: [{ template_count: count }] };
      if (text.includes("INSERT INTO invoice_templates")) {
        if (failure) throw failure;
        state.rows.push(values);
        return { rows: [] };
      }
      state.migrations.push(text);
      if (migrationFailure) throw migrationFailure;
      return { rows: [] };
    },
    async end() {
      state.closed = true;
    },
  };
  vi.resetModules();
  await import(script);
}

test("empty catalog receives every seed with JSON and dates intact", async () => {
  await run("empty", 0, null, [], null, SEED);
  // seed.mjs re-imported invoice-templates after vi.resetModules(); read the same
  // freshly-loaded instance so its load-time createdAt/updatedAt line up.
  const { seedTemplates } = await import("@/lib/invoice-templates/index.ts");
  expect(seedTemplates.length > 0).toBeTruthy();
  expect(state.rows.length).toBe(seedTemplates.length);
  for (const [index, template] of seedTemplates.entries()) {
    const row = state.rows[index];
    expect(row[0]).toBe(template.id);
    expect(JSON.parse(row[10])).toEqual(template.config);
    expect(row[13]).toBe(new Date(template.createdAt).toISOString());
    expect(row[14]).toBe(new Date(template.updatedAt).toISOString());
  }
  expect(state.transactions).toEqual(["begin", "commit"]);
  expect(state.migrations).toEqual([]);
  expect(state.closed).toBe(true);
}, 30000); // Cold-start: first run transforms the drizzle-orm/schema graph.

test("existing catalog is preserved", async () => {
  await run("populated", 1, null, [], null, SEED);
  expect(state.rows).toEqual([]);
  expect(state.transactions).toEqual([]);
  expect(state.closed).toBe(true);
});

test("insert failure propagates and closes the connection", async () => {
  const failure = new Error("Insert failed");
  let thrown;
  try {
    await run("failure", 0, failure, [], null, SEED);
  } catch (error) {
    thrown = error;
  }
  expect(thrown === failure || thrown?.cause === failure).toBeTruthy();
  expect(state.transactions).toEqual(["begin", "rollback"]);
  expect(state.closed).toBe(true);
});

test("only the selected folder runs, in filename order, without seeding", async () => {
  await run("selected", 0, null, ["0002-tool-icon-url"]);
  expect(state.migrations).toEqual(["ICON ONE", "ICON TWO"]);
  expect(state.deleted, "migrations do not contact Redis for the process-local public catalog").toEqual([]);
  expect(state.cloudName).toBe(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || process.env.CLOUDINARY_CLOUD_NAME?.trim() || "",
  );
  expect(state.rows).toEqual([]);
  expect(state.closed).toBe(true);
});

test("baseline runs only its SQL without seeding", async () => {
  await run("0001-baseline");
  expect(state.migrations).toEqual(["BASELINE ONE", "BASELINE TWO"]);
  expect(state.rows).toEqual([]);
});

test("missing, invalid, unknown and empty selections execute nothing", async () => {
  const cases = [
    [],
    ["../baseline"],
    ["/baseline"],
    ["0001-baseline", "0002-tool-icon-url"],
    ["missing"],
    ["empty"],
    ["outside-link"],
  ];
  for (const [index, args] of cases.entries()) {
    await expect(run(`invalid-${index}`, 0, null, args)).rejects.toThrow(/folder|Usage|SQL/);
    expect(state.migrations).toEqual([]);
  }
});

test("SQL failure stops the folder and closes the connection", async () => {
  const failure = new Error("SQL failed");
  let thrown;
  try {
    await run("sql-failure", 0, null, ["0002-tool-icon-url"], failure);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(failure);
  expect(state.migrations).toEqual(["ICON ONE"]);
  expect(state.deleted).toEqual([]);
  expect(state.closed).toBe(true);
});
