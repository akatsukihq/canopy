import { expect, onTestFinished, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("the commit hook runs advisory tests only for staged executable or runtime changes", async () => {
  const step = async (label, fn) => fn();
  const directory = mkdtempSync(join(tmpdir(), "canopy-hook-selection-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, "repository");
  const bin = join(directory, "bin");
  const log = join(directory, "pnpm.log");
  mkdirSync(repository);
  mkdirSync(bin);
  writeFileSync(
    join(bin, "pnpm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOOK_PNPM_LOG"\nif [ "$1" = "test:affected" ]; then exit "${HOOK_TEST_STATUS:-0}"; fi\nexit "${HOOK_FORMAT_STATUS:-0}"\n',
    { mode: 0o755 },
  );
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const run = (command, args, overrides = {}) =>
    spawnSync(command, args, {
      cwd: repository,
      env: { ...environment, PATH: `${bin}:${environment.PATH}`, HOOK_PNPM_LOG: log, ...overrides },
      encoding: "utf8",
      timeout: 10_000,
    });
  const git = (...args) => {
    const result = run("git", args);
    expect(result.error).toBe(undefined);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  };
  const write = (path, content = "changed\n") => {
    const target = join(repository, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const stage = (path) => {
    write(path);
    git("add", "--", path);
  };
  const hook = (overrides) => {
    writeFileSync(log, "");
    const result = run("sh", [fileURLToPath(new URL("../.githooks/pre-commit", import.meta.url))], overrides);
    expect(result.error).toBe(undefined);
    return { ...result, calls: readFileSync(log, "utf8").trim().split("\n") };
  };
  git("init", "--quiet");
  git("config", "user.name", "Hook test");
  git("config", "user.email", "hook-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", ".git/hooks");
  stage("tracked.js");
  git("commit", "--quiet", "-m", "fixture");
  const reset = () => {
    git("reset", "--hard", "HEAD");
    git("clean", "-fd");
  };
  const skipsTests = [
    "README.md",
    "docs/guide.md",
    ".gitignore",
    ".prettierignore",
    ".codex/config.toml",
    "design.pen",
    "public/image.png",
    "public/logo.svg",
    "scripts/seed-assets/preview.png",
    "docs/looks-like-code.ts\nnotes.md",
  ];
  const runsTests = [
    ...["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"].map((extension) => `app/source.${extension}`),
    "app/styles.css",
    "app/styles.scss",
    "db/schema.sql",
    "scripts/check.sh",
    "tests/feature.test.mjs",
    ".githooks/pre-commit",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "next.config.mjs",
    "Dockerfile",
    "compose.yml",
    ...["app", "lib", "db", "tools", "tests"].map((scope) => `${scope}/data.json`),
    "app/with spaces [route].tsx",
    "app/with\nnewline.ts",
    "-leading-dash.ts",
  ];
  for (const [paths, shouldTest] of [
    [skipsTests, false],
    [runsTests, true],
  ]) {
    for (const path of paths) {
      await step(`${shouldTest ? "tests" : "skips tests for"} ${JSON.stringify(path)}`, () => {
        reset();
        stage(path);
        const result = hook();
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.calls).toEqual(shouldTest ? ["test:affected", "exec lint-staged"] : ["exec lint-staged"]);
      });
    }
  }
  for (const [name, prepare, shouldTest] of [
    ["no staged files", () => {}, false],
    ["unstaged source edits", () => write("tracked.js", "unstaged\n"), false],
    [
      "staged docs alongside unstaged source",
      () => {
        stage("README.md");
        write("tracked.js", "unstaged\n");
      },
      false,
    ],
    ["source deletion", () => git("rm", "tracked.js"), true],
    ["source renamed to documentation", () => git("mv", "tracked.js", "notes.md"), true],
  ]) {
    await step(name, () => {
      reset();
      prepare();
      const result = hook();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.calls).toEqual(shouldTest ? ["test:affected", "exec lint-staged"] : ["exec lint-staged"]);
    });
  }
  await step("advisory test failures still allow formatting", () => {
    reset();
    stage("app/changed.ts");
    const result = hook({ HOOK_TEST_STATUS: "1" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.calls).toEqual(["test:affected", "exec lint-staged"]);
  });
  await step("formatting failures fail the hook", () => {
    reset();
    stage("README.md");
    const result = hook({ HOOK_FORMAT_STATUS: "23" });
    expect(result.status, result.stdout + result.stderr).toBe(23);
    expect(result.calls).toEqual(["exec lint-staged"]);
  });
}, 120000);
