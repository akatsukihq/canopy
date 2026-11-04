# Tool regression tests

Tool tests live beside the implementation:

```text
tools/json-formatter/
  run.ts
  run.test.mjs
  workspace.tsx
  workspace.test.mjs
  streaming.test.mjs
```

`run.test.mjs` checks execution, settings, invalid input, boundaries, and exact output. `workspace.test.mjs` mounts the actual React workspace in jsdom and exercises user-visible input, settings, validation, recovery, and export behavior. A few tools have additional suites for streaming, conversion, or runtime integration. Common test helpers live in `tests/helpers`.

This change adds tool tests only for these families:

| Family | Tools |
| --- | ---: |
| JSON | 20 |
| Text | 14 |
| Web & Markup | 8 |
| Date & Time | 5 |
| Developer Generators | 8 |
| Diagram | 1 |
| SEO & Domain | 3 |

The existing Vitest configuration discovers both `tests/**/*.test.mjs` and `tools/**/*.test.mjs`. Tool tests use the same commands as the rest of the repository; there is no separate tool-test runner. New tool tests belong in their owning folder and are discovered automatically.

## Running tests

```sh
# Run the existing repository suite, including colocated tool tests.
pnpm test

# Run tests affected by current changes (also used by the commit hook).
pnpm test:affected

# Compare against another Git revision.
pnpm test:affected origin/main

# Restrict the ordinary command to one tool while iterating.
pnpm test tools/json-formatter/

# Explicitly run all colocated tool suites.
pnpm test tools/

# Use the existing watch command for one tool.
pnpm test:watch tools/json-formatter/

# Coverage remains opt-in; restrict both tests and instrumented files.
pnpm test tools/json-formatter/ --coverage --coverage.include='tools/json-formatter/*.ts' --coverage.include='tools/json-formatter/*.tsx'
```

This checkout already enables `.githooks/pre-commit`, which invokes `pnpm test:affected` for staged source/configuration changes, including tool changes. That existing hook is advisory: failed tests do not block a commit. This change does not install a new hook, recurring job, or CI workflow.

These tool tests require no application server, database, browser launch, or Playwright test. The commands use the repository's installed Vitest.

Vitest runs one worker and one test file at a time. Worker JavaScript heaps are capped at 2 GiB; the standard test, affected, and watch commands cap the coordinator's JavaScript heap at 768 MiB and start in UTC. These are heap limits, not total RAM limits. Coverage is off by default. Prefer affected tests or one tool while iterating, keep coverage to a small explicit scope, and do not run several test commands concurrently.

Affected selection uses Vitest's existing Git and dependency-graph handling, including staged, unstaged, and untracked files. A supplied revision uses Git's merge-base comparison. Direct imports connect tool tests to their adapters, definitions, workspaces, and shared dependencies. Package, lockfile, workspace-dependency, and Vite/Vitest configuration changes force a full rerun. This is repository-wide selection, so changes to shared code can also select existing non-tool tests. Dynamically computed imports and files read directly from disk may not appear in the dependency graph; use an explicit tool path when changing those boundaries. Vitest may analyze dependencies concurrently even though test execution is serial.

## What the React checks prove

Workspaces run with real React state and real tool adapters. Tests control external services, clipboard operations, download URLs, worker messages, time, or randomness where necessary. Requests in network tests are deterministic fixtures, not calls to live providers. CodeMirror's geometry-dependent rendering is replaced by a controlled textarea boundary; editor-specific behavior is covered separately where supported.

Workspace harnesses exercise input, controls, validation, and results. They do not reimplement the production runtime as evidence of lifecycle correctness. Separate full `ToolPage` integration tests cover live execution and settings refresh, reset and debounce cancellation, DNS errors and retries, stale completions, and the Domain Rating server-host flow.

jsdom cannot establish visual layout, actual clipboard permissions, browser downloads, CodeMirror geometry, scrolling synchronization, browser worker startup, or Mermaid's actual SVG geometry. SVG/export contracts and worker message handling are checked at those dependency boundaries. These tests do not claim browser or visual coverage.

Coverage reports are written to the system temporary directory under `canopy-tool-coverage`, including when tests fail. Coverage measures which code ran; assertions and per-tool scenarios determine whether behavior is correct. It does not establish that every possible input has been tested.

## Maintaining expectations

Add scenarios to the owning tool folder. Keep expected outputs explicit and independent of the implementation. Include relevant default settings, each supported option, malformed and boundary inputs, error recovery, and exact exported values. Use existing shared helpers where they match the task; do not mock the behavior being asserted.

DOM assertions should compare primitive values such as presence, text, disabled state, and element counts. Avoid comparing whole React-owned DOM objects: a failed assertion can expand their object graph and exhaust memory while preparing its error message.

An assertion that exposes a current defect remains a normal failing test. Do not skip it, mark it as an expected failure, weaken it, or regenerate its expected output to make the suite green. An intentional behavior change should update the implementation and the relevant reviewed expectations together.

## Regression fixes

The tests exposed production defects, which are fixed together with their regression cases:

- JavaScript formatting and minification preserve string, regex, and nested template literals, significant line breaks, and separate operators. The existing Lezer JavaScript parser is now a direct dependency so token boundaries come from syntax rather than string replacements.
- CSS formatting and minification preserve quoted content, duplicate-property order, and math spacing. Wrapping an unbreakable token terminates.
- HTML formatting preserves quoted attributes and script, style, pre, and textarea contents.
- Date-only local intervals account for daylight-saving transitions. Zero-width Unicode regex matches advance by a complete code point.
- JSON schemas handle empty arrays, structural enum equality, Unicode lengths, own properties, and alternative types. Generated TypeScript groups mixed-array unions correctly.
- XML conversions preserve a single document root, quoted attributes, entities, CDATA, and prototype-like names.
- JSON Viewer preserves exact source numbers for viewing, copying, and downloading when parsing would lose precision, and blocks unsafe tree edits.
- DNS and domain checks propagate cancellation rather than publishing an obsolete result or misclassifying it as an upstream failure.

Verified on 2026-09-25 with the existing `pnpm test` command, coverage disabled, one worker, and the default 2 GiB worker heap: 2,667 passed, 30 existing skips, no failed tests or uncaught errors (205.47 seconds). The selected 59 tools account for 1,056 passing cases in 145 colocated test files. Application TypeScript checking also passed with `--noEmit --incremental false`. Coverage percentages from the interrupted earlier run are not a completion criterion.
