import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const qpdfRoot = dirname(fileURLToPath(import.meta.resolve("qpdf-wasm")));
const heicRoot = dirname(fileURLToPath(import.meta.resolve("heic-to")));
const qpdfTarget = join(appRoot, "public/media/vendor/qpdf");
const licenseTarget = join(appRoot, "public/media/vendor/licenses");

await Promise.all([mkdir(qpdfTarget, { recursive: true }), mkdir(licenseTarget, { recursive: true })]);
await Promise.all([
  copyFile(join(qpdfRoot, "qpdf.js"), join(qpdfTarget, "qpdf.js")),
  copyFile(join(qpdfRoot, "qpdf.wasm"), join(qpdfTarget, "qpdf.wasm")),
  copyFile(join(heicRoot, "../LICENSE"), join(licenseTarget, "heic-to-LGPL-3.0.txt")),
]);

// SQLite WASM for the SQL compiler page. The versioned folder busts the
// immutable cache on upgrade; tools/sql-compiler/script.ts names the same path.
const sqliteRoot = dirname(fileURLToPath(import.meta.resolve("@sqlite.org/sqlite-wasm/package.json")));
const { version: sqliteVersion } = JSON.parse(await readFile(join(sqliteRoot, "package.json"), "utf8"));
const sqliteTarget = join(appRoot, "public/code/vendor/sqlite", sqliteVersion);

await mkdir(sqliteTarget, { recursive: true });
await Promise.all([
  copyFile(join(sqliteRoot, "dist/index.mjs"), join(sqliteTarget, "index.mjs")),
  copyFile(join(sqliteRoot, "dist/sqlite3.wasm"), join(sqliteTarget, "sqlite3.wasm")),
  // The package ships no LICENSE file; record its declared terms beside the binary.
  writeFile(
    join(sqliteTarget, "LICENSE.txt"),
    "@sqlite.org/sqlite-wasm " +
      sqliteVersion +
      "\nLicense: Apache-2.0 (https://github.com/sqlite/sqlite-wasm/blob/main/LICENSE)\nSQLite itself is in the public domain (https://sqlite.org/copyright.html).\n",
  ),
]);

// PGlite (PostgreSQL as WASM) for the SQL compiler's PostgreSQL engine. Only the browser ESM
// build and the assets it loads by relative URL; tools/sql-compiler/script.ts names the same path.
// package.json is not exported; the main entry is dist/index.js.
const pgliteRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@electric-sql/pglite"))));
const { version: pgliteVersion } = JSON.parse(await readFile(join(pgliteRoot, "package.json"), "utf8"));
const pgliteTarget = join(appRoot, "public/code/vendor/pglite", pgliteVersion);
const pgliteFiles = (await readdir(join(pgliteRoot, "dist"))).filter((name) => /\.(?:js|wasm|data)$/.test(name));
await mkdir(pgliteTarget, { recursive: true });
await Promise.all([
  ...pgliteFiles.map((name) => copyFile(join(pgliteRoot, "dist", name), join(pgliteTarget, name))),
  copyFile(join(pgliteRoot, "LICENSE"), join(pgliteTarget, "LICENSE.txt")),
]);

// TypeScript standard-library declarations for the JS/TS editor's language-service worker,
// bundled into one JSON file so the worker needs a single same-origin request.
const tsRoot = dirname(fileURLToPath(import.meta.resolve("typescript-browser/package.json")));
const { version: tsVersion } = JSON.parse(await readFile(join(tsRoot, "package.json"), "utf8"));
const tsTarget = join(appRoot, "public/code/vendor/typescript", tsVersion);
const tsLibNames = (await readdir(join(tsRoot, "lib"))).filter((name) =>
  /^lib\.(?:es5|es20(?:1[5-9]|2[0-3])(?:\.(?!full)[\w.]+)?|decorators(?:\.legacy)?)\.d\.ts$/.test(name),
);
const tsLibs = Object.fromEntries(
  await Promise.all(tsLibNames.map(async (name) => [name, await readFile(join(tsRoot, "lib", name), "utf8")])),
);
await mkdir(tsTarget, { recursive: true });
await writeFile(join(tsTarget, "lib.json"), JSON.stringify(tsLibs));
