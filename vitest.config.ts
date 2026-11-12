import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";

// Root-relative "@/..." alias mirrors tsconfig paths so tests resolve app modules
// the same way the app does.
const root = fileURLToPath(new URL(".", import.meta.url));

// The tool framework dynamically imports tool modules by key without a file
// extension (e.g. import(`../../tools/${key}/definition`)), relying on the
// Next.js/webpack context-module bundler. Vite's dynamic-import-vars rewrites
// these into a build-time glob map, which bypasses vitest's module runner:
// vi.mock never applies and missing tools throw a Vite-specific message the
// worker cannot classify. Marking them @vite-ignore leaves the import for the
// runner to resolve, so vi.mock works and missing modules raise the Node-style
// "Cannot find module" the framework already handles. Test-only; app runtime
// is unchanged.
const toolDynamicImportExtensions: Plugin = {
  name: "canopy-tool-dynamic-import-runner",
  enforce: "pre",
  transform(code, id) {
    if (!/\.[cm]?tsx?$/.test(id) || !code.includes("/tools/") || !code.includes("import(`")) return null;
    const patched = code.replace(/import\((`[^`]*\/tools\/\$\{[^`]*`)\)/g, "import(/* @vite-ignore */ $1)");
    return patched === code ? null : { code: patched, map: null };
  },
};

export default defineConfig({
  plugins: [toolDynamicImportExtensions],
  resolve: {
    // `server-only` throws outside a Server Component build; tests have no such
    // build step, so resolve it to an empty module as the per-file mocks do.
    alias: { "@": root, "server-only": path.join(root, "tests/stubs/server-only.mjs") },
  },
  test: {
    // next-intl's Next.js entrypoints use extensionless framework imports.
    // Run them through Vite's resolver, as Next's application bundler does.
    server: { deps: { inline: ["next-intl"] } },
    globals: true,
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: ["--max-old-space-size=2048"],
    include: ["tests/**/*.test.mjs", "tools/**/*.test.mjs", "packages/*/src/**/*.test.mjs"],
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/pnpm-lock.yaml", "**/pnpm-workspace.yaml"],
    // Playwright specs run under their own runner; integration tests are opt-in.
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: path.join(tmpdir(), "canopy-tool-coverage"),
      reportOnFailure: true,
    },
  },
});
