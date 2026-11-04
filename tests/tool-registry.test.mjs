import { expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as catalog from "../lib/tool-catalog/index.ts";
import { allToolSpecs } from "./helpers/toolSpec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = path.join(ROOT, "tools");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

/**
 * Paperwork predates this architecture and is explicitly excluded from it
 * (`tools/AGENTS.md`: "Paperwork is separate and must not depend on this
 * architecture"). Its `componentKey === "invoice-generator"` branches are not
 * tool-folder dispatch and are not scheduled for deletion, so they are out of
 * scope rather than allowlisted.
 */
const OUT_OF_SCOPE = ["app/paperwork"];

/**
 * KNOWN-LEGACY IDENTITY DISPATCH — THIS LIST MUST SHRINK TO EMPTY.
 * Do not add entries to make this check pass; remove them after migration.
 */
const LEGACY_IDENTITY_DISPATCH = new Set([]);

async function walk(dir, accumulated = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return accumulated;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      await walk(full, accumulated);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      accumulated.push(full);
    }
  }
  return accumulated;
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

async function sharedSourceFiles() {
  const files = [];
  for (const dir of ["lib", "components", "app", "packages"]) {
    files.push(...(await walk(path.join(ROOT, dir))));
  }
  // Shared modules that sit directly in `tools/`, outside any tool folder.
  for (const entry of await readdir(TOOLS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(TOOLS_DIR, entry.name));
    }
  }
  return files
    .map(relative)
    .filter((file) => !OUT_OF_SCOPE.some((prefix) => file.startsWith(`${prefix}/`)))
    .sort();
}

const toolFolders = (await readdir(TOOLS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const RUN_FILENAMES = ["run.ts", "run.worker.ts", "run.server.ts"];

async function readIfPresent(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

const folders = await Promise.all(
  toolFolders.map(async (name) => {
    const dir = path.join(TOOLS_DIR, name);
    const runFiles = [];
    for (const runFile of RUN_FILENAMES) {
      if ((await readIfPresent(path.join(dir, runFile))) !== null) runFiles.push(runFile);
    }
    return { name, dir, runFiles };
  }),
);

// Specs live in the database; a folder holds only the code that runs one.
const specs = (await allToolSpecs()).map((spec) => ({ name: spec.toolId.split(".")[1], spec }));

// ---------------------------------------------------------------------------
// The central invariant.
// ---------------------------------------------------------------------------

/**
 * Dispatch on tool identity. Narrower than a bare `key === "..."` scan on
 * purpose: `key`, `slug` and `operation` are ordinary words, and matching them
 * against any literal flags settings loops and auth navigation that have
 * nothing to do with tools. A comparison is tool dispatch when the field is
 * tool-identity-specific (`componentKey` / `definitionKey`) or when the literal
 * is an actual tool folder name — which is exactly the thing that must vanish.
 */
const IDENTITY_DISPATCH = new RegExp(
  String.raw`\b(?:componentKey|definitionKey)\s*===\s*["']` +
    "|" +
    String.raw`\b(?:componentKey|definitionKey|slug|operation|key)\s*===\s*["'](?:` +
    toolFolders.join("|") +
    String.raw`)["']`,
);

function scan(source, matches) {
  const hits = [];
  source.split("\n").forEach((line, index) => {
    for (const hit of matches(line)) hits.push({ line: index + 1, hit });
  });
  return hits;
}

const sharedFiles = await sharedSourceFiles();
const dispatchByFile = new Map();

for (const file of sharedFiles) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  const dispatch = scan(source, (line) => (IDENTITY_DISPATCH.test(line) ? [line.trim().slice(0, 80)] : []));
  if (dispatch.length > 0) dispatchByFile.set(file, dispatch);
}

function report(byFile) {
  return [...byFile]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([file, hits]) => `  ${file} (${hits.length})\n${hits.map((h) => `    ${file}:${h.line}: ${h.hit}`).join("\n")}`,
    )
    .join("\n");
}

test("shared code never dispatches on a tool identity", () => {
  console.log(`[identity dispatch scan] ${dispatchByFile.size} files\n${report(dispatchByFile)}`);
  const unexpected = [...dispatchByFile.keys()].filter((file) => !LEGACY_IDENTITY_DISPATCH.has(file));
  expect(
    unexpected,
    `tool dispatch must be a module path, not a comparison:\n${report(
      new Map(unexpected.map((file) => [file, dispatchByFile.get(file)])),
    )}`,
  ).toEqual([]);
});

test("the legacy identity-dispatch allowlist only shrinks", () => {
  const stale = [];
  for (const file of LEGACY_IDENTITY_DISPATCH) {
    // A deleted file is progress, not staleness; only a surviving-but-clean
    // file means the allowlist entry was left behind.
    if (sharedFiles.includes(file) && !dispatchByFile.has(file)) {
      stale.push(file);
    }
  }
  expect(stale, "remove these cleaned-up files from the allowlist").toEqual([]);
});

// ---------------------------------------------------------------------------
// The folder contract.
// ---------------------------------------------------------------------------

// Prefer the exported pattern; fall back to the catalogue's own literal while
// `TOOL_SLUG_PATTERN` is still module-private (see report).
const TOOL_SLUG_PATTERN = catalog.TOOL_SLUG_PATTERN ?? /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test("every tool folder has exactly one stored spec and every spec has a folder", () => {
  const specFolders = specs.map(({ name }) => name).sort();
  expect(new Set(specFolders).size, "two stored specs share a folder").toBe(specFolders.length);
  expect(specFolders, "stored specs and tools/ folders must match one to one").toEqual(toolFolders);
});

test("folder names are valid tool slugs", () => {
  for (const folder of toolFolders) {
    expect(folder, `${folder} is not a valid tool slug`).toMatch(TOOL_SLUG_PATTERN);
  }
});

test("every tool folder declares exactly one execution host", () => {
  for (const folder of folders) {
    expect(
      folder.runFiles.length,
      `${folder.name}: expected exactly one of ${RUN_FILENAMES.join(" / ")}, found [${folder.runFiles.join(", ")}]`,
    ).toEqual(1);
  }
});

test("a declared slug is valid and unreserved", () => {
  for (const { name, spec } of specs) {
    if (spec.slug === undefined) continue;
    expect(spec.slug, `${name}: invalid slug`).toMatch(TOOL_SLUG_PATTERN);
    expect(
      catalog.isValidToolSlug(spec.app, spec.slug),
      `${name}: slug "${spec.slug}" is reserved for app "${spec.app}"`,
    ).toBeTruthy();
  }
});

test("hooks live in hooks.ts and never reach the media graph", async () => {
  // `hooks.ts` is called from the main thread. `media/pdfRender.ts` is the sole owner of
  // `pdfjs-dist` and is worker-only, so a hook that imports anything under
  // `media/` — or that stays in a run file which does — puts the vendor chunk
  // back on the main thread. Module specifiers only; a mention in a comment is
  // not an edge in the import graph.
  const MEDIA_IMPORT = /(?:from|import)\s*\(?\s*["'][^"']*tool-framework\/media\//;
  const RUN_HOOK_EXPORT =
    /^\s*export\s+(?:const|function|async\s+function)\s+(?:validate|onPagesInspected|onSettingsChanged)\b/m;
  const offenders = [];
  for (const folder of folders) {
    const hooksSource = await readIfPresent(path.join(folder.dir, "hooks.ts"));
    if (hooksSource !== null && MEDIA_IMPORT.test(hooksSource)) {
      offenders.push(`${folder.name}/hooks.ts imports lib/tool-framework/media/`);
    }
    for (const runFile of folder.runFiles) {
      const runSource = await readIfPresent(path.join(folder.dir, runFile));
      if (runSource !== null && RUN_HOOK_EXPORT.test(runSource)) {
        offenders.push(`${folder.name}/${runFile} exports a hook — move it to hooks.ts`);
      }
    }
  }
  expect(offenders, "hooks must live in hooks.ts and stay off the worker-only media graph").toEqual([]);
});

test("no client or worker module imports a server run module", async () => {
  // Cheaper inverse of the import-graph walk: nothing in the shared framework
  // or component layer may statically reach a `run.server` module, so a
  // server-only run can never be pulled into a client or worker bundle.
  const clientSide = [
    ...(await walk(path.join(ROOT, "lib/tool-framework"))),
    ...(await walk(path.join(ROOT, "components"))),
  ];
  const offenders = [];
  for (const file of clientSide) {
    const source = await readFile(file, "utf8");
    // Module specifiers only — a `run.server.ts` mention in a comment is not
    // an edge in the import graph.
    if (/(?:from|import)\s*\(?\s*["'][^"']*run\.server\b/.test(source)) {
      offenders.push(relative(file));
    }
  }
  expect(offenders, "run.server modules must stay off the client graph").toEqual([]);
});
