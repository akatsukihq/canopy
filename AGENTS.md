# Repository Guidelines

## Scope and Working Rules

This file is the repository-wide baseline. Read the nearest `AGENTS.md` before editing. Add a nested `AGENTS.md` only when an route scope or module has genuinely different commands or constraints, and put only those differences in it.

Before changing code:

1. Inspect `git status --short` and preserve unrelated work.
2. Search the target route, `lib`, `db`, and `components` for an existing component, helper, type, schema, or pattern.
3. Trace the callers and consumers of code being changed.
4. Make the smallest change that solves the current task; do not add scaffolding for possible future work.

Do not reorganize unrelated existing files during feature or bug work. New code must follow the structure below. When moving code, update every import, remove the old file, and avoid compatibility re-exports unless the old path is a real public API.

## Application Boundaries

This is one Next.js application managed with pnpm:

- `app`, `lib`, `db`, and `public` — the root SmartTools application, including `/paperwork`, `/devtools`, `/media`, `/auth`, and `/admin` route scopes (port 3000).
- `tools/*` — flat, application-owned tool definitions, execution adapters, and optional tool-owned workspaces keyed by stable definition key.
- `components/ui` — the shared application design system.
- `tests/*` — repository-level regression and architecture tests.
- `packages/cli` — the `canopy` developer CLI (`canopy tool new`). Plain ESM, no app imports except the category registry, so it stays publishable.

Do not create a root-level `src`, a top-level `components` folder for one route scope, or a vague `shared` directory. Do not create empty directories.

The application does not use Next.js's optional `src` directory. Keep runtime code in the root-owned directories above. Application modules must not form dependency cycles.

## Mandatory File Placement

Place code at the narrowest scope that owns it. Promote code only when a real second consumer needs it.

| Code ownership | Location |
| --- | --- |
| Small helper, type, or constant used by one file | Keep it in that file |
| Used only by one route scope | `app/<route>/components`, `app/<route>/lib`, or `app/<route>/hooks` |
| UI reused across unrelated route scopes | `components/<domain>` |
| Domain logic or an integration reused across routes | `lib/<domain>` |
| Small pure, domain-neutral helper reused across routes | `utils/<capability>.ts` |
| Database client, schema, or bootstrap code | `db` and server-only modules |
| Static browser-served asset | `public` |
| One tool's definition, execution adapter, result contract, or complete left workspace | `tools/<definition-key>` |
| Repository regression test | `tests/*.test.mjs` |

`app` owns Next.js routing: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, and colocated implementation folders. Route handlers and pages should be thin adapters; reusable logic belongs at the ownership level above. Use `(group)` only to organize routes without changing URLs. A folder without a `page.tsx` does not create a public route.

`utils` is not a dumping ground. Business rules, storage, API clients, database access, and feature-specific transformations belong in `lib/<domain>` or the route's `_lib`. Prefer descriptive names such as `currency.ts` or `invoiceTotals.ts`; do not add vague `helpers.ts`, `common.ts`, `misc.ts`, or a second catch-all `utils.ts`.

Do not create a standalone file for a one-use wrapper, interface, constant, or trivial function. Do not add app-internal barrel files merely to shorten imports.

## Shared Code and Dependencies

- Reuse an existing helper when it has the same responsibility; do not force unrelated behavior into it merely to avoid a new file. Don't also go creating a new file for only a single function.
- Keep capabilities in application-owned folders. Extract a package only when a real second application or service needs it.
- Declare runtime and development dependencies in the root `package.json`.
- Use pnpm only. Add dependencies with `pnpm add <package>`; do not hand-edit `pnpm-lock.yaml`.
- Before adding a production dependency, prefer the standard library, the web/Next.js platform, or an already-installed dependency. Record the reason when a new dependency is necessary.

## Next.js and TypeScript Rules

- Default to Server Components. Add `"use client"` only at the smallest interactive boundary.
- Keep secrets, database access, and server-only dependencies out of Client Components.
- Validate request params, headers, and bodies at route-handler boundaries before calling domain logic.
- Use TypeScript and ESM imports. Avoid `any`; when legacy code already uses it, do not spread it into new boundaries.
- Use the root application's existing `@/*` alias for application-owned modules.
- Component and type names use PascalCase; functions and variables use camelCase; constants use `UPPER_SNAKE_CASE`; route directories use kebab-case.
- Component files use `PascalCase.tsx`; non-component TypeScript files follow the nearby convention and use descriptive names.

## UI and Design-System Rules

- Use the shared shadcn Base UI Toast for floating notifications, including operation errors. Keep field validation and word-limit feedback beside the field in the design-system error color; reuse helper or count text instead of adding an alert banner or toast-style card inside the form. Associate field errors with their inputs and announce updates accessibly.

- Design for normal desktop and laptop browser viewports first, not televisions, ultrawide monitors, or oversized presentation canvases. Unless the user explicitly requests another target, use **1366 × 768 CSS pixels** as the default desktop viewport for both `.pen` screen designs and implemented UI; also verify usability at **1280 × 720**. These are browser content dimensions, not physical display resolutions.
- Do not enlarge the viewport to make a layout fit. Adapt columns, sidebars, toolbars, spacing, and content density to the available space without shrinking text or controls below accessible sizes. Core input, a useful task surface, and the primary action must be discoverable in the initial viewport; longer content may scroll vertically. Avoid page-level horizontal overflow.
- Full-page canvas frames may extend vertically to document scrollable content, but their height must not be treated as the visible browser viewport. Review the initial viewport separately. Large component-library boards and horizontally arranged flow stages are documentation, not individual screen dimensions. Wider desktop variants are supplemental, never a substitute for validating the normal desktop baseline.

- Use shared design-system tooltips for hover and keyboard-focus help, never native HTML `title` attributes. Prefer a shared control's `tooltip` prop over repeating tooltip wrappers; scope `TooltipProvider` around a group. Keep disabled-control help keyboard-accessible and show essential descriptions inline. Semantic component props such as a page heading's `title` are unaffected.
- Design page layouts around content relationships and available space. Keep related headings, filters, actions, and supporting content inline or in responsive grids when that improves scanning and space use; stack them into full-width rows only when the content or viewport requires it. Do not default to a repetitive row-after-row layout.
- Before creating or redesigning UI, inspect the existing reusable components and design tokens in the relevant codebase or `.pen` document.
- Reuse existing design-system components through real component instances or references. Do not create hand-built visual lookalikes for an available header, footer, button, input, select, textarea, toggle, checkbox, alert, badge, card, table row, navigation item, workbench, or other reusable component.
- Displayed code chunks, generated snippets, commands, and code-valued outputs must use the existing lightweight `SyntaxHighlight` from `components/content/SyntaxHighlight` with an explicit language; compose it with `CodeBlock` for multiline blocks. Do not introduce a code editor just to highlight a snippet. Preserve existing interactive code panes and their highlighting, exact copy/download values, and the shared highlighter's safe fallback for unsupported languages or oversized content. Ordinary text and identifiers are not code snippets.
- Editor suggestions are optional enhancements: keep autocomplete and language packages that import it outside the initial page-load path. Use the shared editor's cancellable load-then-idle scheduling and dynamic imports; basic editing must work while these features load or if they fail. Load completion support only for focused, editable editors, preserve text/selection/undo when it arrives, and apply this policy to every suggestion-enabled editor.
- **Mandatory result clarity:** Every tool result must make sense to a first-time user without reading documentation or decoding syntax. Lead with the answer or outcome in plain language; label values and include units, timezone, assumptions, or limitations when they affect the meaning. Explain technical terms and non-obvious rules beside the result, with a concrete example when useful. Keep exact code, expressions, and raw data available in a clearly labelled secondary section or view with accurate copy/download actions. Use normal readable typography for explanations, reserving code styling for actual code. A raw field dump, restated input, unexplained number, or generic “Ready” message alone is not an acceptable result. Before shipping, verify that a user can answer “What does this mean, and what can I do with it?” from the result itself. This follows [GOV.UK clear-language guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/) and applies equally to developer tools.
- When the same meaningful UI pattern appears three or more times, extract or extend a reusable design-system component before creating more copies. Document it in the component library and build subsequent uses as instances with page-specific overrides.
- A shared workbench or component-family overview does not replace page coverage. When the task requires every implemented route or tool page, create and clearly label a separate complete page design for each route, while instancing the shared family component inside each page.
- Preserve all previously created designs. Do not delete an existing page, screen, state, workbench, component, or design section unless the user explicitly requests deletion. Refactor in place or add new coverage instead.
- Page-specific content, controls, states, and results must remain tailored to the implemented feature even when pages share the same reusable shell.
- Every tool type must pass an operation-model gate before visual polish is accepted. State the tool's primary verb, manipulated object, natural direct interaction, expected content geometry and density, workspace ownership, recovery, and final action. A coherent generic shell, navigator, metadata recap, or placeholder does not pass when the job requires direct manipulation, selection, editing, comparison, generation, or a real preview.
- Treat the main workspace as the task surface: it must show the real input, object, editor, selection surface, preview, or result content required by the tool. Persistent configuration belongs in the settings panel. Completion facts and artifact actions must follow the project convention for that output and must never replace the required task surface.
- Validate space economy against the operation, not against the current layout. Repeated objects must use a structure and orientation suited to their geometry, count, and scanning task. Distinguish the visible size of an affordance from its interactive hit target; accessibility sizing must not make a small-card control visually dominate its content.
- When a shared workspace or component is replaced, explicitly re-check dividers, panel boundaries, status bars, feedback, recovery controls, and action placement. Do not accept regressions merely because the replacement node renders without clipping.
- Only when creating or materially changing UI designs in Pencil (`.pen` files),
  run both repo-local design validators before finalizing the design:
  `ui_validator` for visual consistency and accessibility
  risks, and `end_user_validator` for problem fit, novice feasibility,
  scanability, feedback, recovery, and complete handoff. These validators are
  read-only and apply exclusively to Pencil designs. Do not invoke either agent
  for application code changes, bug fixes, browser validation, or code review.
  Resolve their substantive findings in the `.pen` design, then capture fresh
  Pencil screenshots and re-run both validators until the design passes.
- For developer-handoff tool flows, arrange materially different stages horizontally in user order: initial state, interaction/transition states, then final output. A stage may span multiple screens only when the workspace or available actions genuinely change.
- Every flow screen must show what action produced it, what controls are now available, and the next valid action. A developer should not need to infer missing click behavior or ask how one screen reaches the next.
- Do not duplicate generic empty, validation, processing, or completed screens when the shared state pattern already communicates them and the primary workspace is unchanged.
- For Media tools, keep the reusable shell structural and make the main workspace operation-specific. The normal file-processing handoff is upload, uploaded-file interaction/preview, and final output with result facts, generated-file metadata or lists, completion feedback, and download actions together in the right panel. The left side may retain source context or a materially useful visual preview, but must not duplicate the result panel.
- Before finalizing any tool screen or flow, inspect the current screenshots as an end user and require four explicit passes: problem fit, new-user feasibility, five-second scanability, and feedback/recovery. The user must be able to locate the purpose, input, primary action, settings, current state, result, and next action without outside explanation.
- Do not finalize a flow with a dead end, an unexplained control, a generic placeholder where the operation requires a real preview, unclear validation or processing status, an error without recovery guidance, or a completed result without its expected copy/download/print/export action. Record the pain point, revise the design, and re-check the full flow.

## Change and Artifact Hygiene

- [IMP] Scratch scripts, screenshots, logs, profiling output, and diagnostics go in `/tmp`, not in the repository.
- Never commit `.next`, `dist`, `build`, coverage output, `*.tsbuildinfo`, logs, populated environment files, or editor/agent state. Add repeatable generated output to `.gitignore`.
- Do not edit generated files such as `next-env.d.ts` or lockfiles by hand.
- Do not mix broad renames, formatting, dependency upgrades, or directory migrations into an unrelated task.
- Preserve public behavior unless the task explicitly changes it. A file move alone must not change runtime behavior.

## Tool SEO and translation audits

For a combined tool translation/SEO audit, the parent agent coordinates these project roles:

1. Run `canopy_content_mapper` once for the requested tool/locales. Give both reviewers the same evidence snapshot, including exact strings or retrievable references, behavior, provenance, and gaps.
2. Run `translation_validator` in `AUDIT` mode and `seo_auditor` in `AUDIT` mode in parallel. Review every requested locale in batches; sample only when the user asks for sampling. Keep unknown facts and unavailable checks explicit.
3. Reconcile their findings into one exact proposal bundle with an ID/version and evidence snapshot ID. Resolve conflicting edits; preserve the current values, keys/owners, English source, and runtime contracts. A changed string creates a new version.
4. Have `translation_validator` run `VALIDATE_PROPOSAL` and `seo_auditor` run `RECHECK_PROPOSAL` against the same bundle. Candidate validation overlays proposed changes in memory; it must not validate only the old stored messages. Run independent reviews in parallel.
5. Feed corrections into a new version and repeat the affected reviews. Finish as approved only when both reviewers approve the exact same final version and all requested coverage is complete. Never reuse approval after text or relevant evidence changes. Missing checks remain `UNVERIFIED`; new UI/content fields remain `REQUIRES_IMPLEMENTATION`.
6. If missing evidence, repeated disagreement, or three revision rounds prevent approval, return the concrete unresolved items and checks needed to continue. Do not loop indefinitely, weaken criteria, or label the audit complete. The parent owns this handoff; these agents do not send external messages or apply changes.

These reviews produce proposed fixes only. Approval of copy does not prove deployed behavior, native-speaker certification, indexing, or rankings. Use a single specialist directly for a narrower request, with only the evidence mapping it needs.

## Testing and Verification

Tests use `node:test` and `node:assert`; name repository tests `tests/*.test.mjs`.
Add tests for logical changes: business rules, validation, data
transformations, state transitions, execution behaviour, API or database
boundaries, and regression-prone logic. Tests must verify externally observable
outcomes rather than implementation details.

Use TDD only for logical or behavioural changes where a test adds real value.
For basic UI changes, use the relevant typecheck or lint command and inspect the
rendered interface.

Do not add tests that read source files and assert imports, component names, JSX
text, utility classes, or other implementation structure. Do not add regression
tests for component placement, styling, spacing, copy, or other visual-only
changes. Verify those changes with the relevant typecheck or lint command and
rendered UI inspection.
Enforce architecture boundaries with typechecking, linting, or dependency
tooling instead of source-text assertions.

For code changes:

1. Run the smallest relevant test while iterating.
2. Run only affected test suites with `node --test tests/<affected>.test.mjs`, including tests for affected consumers of shared code. Run the full suite with `pnpm test` only when explicitly requested or there are more changes than ideal changes done, do not run it automatically before every commit.
3. Run only the typecheck or lint checks relevant to the changed surface; use `pnpm lint` when the application-wide TypeScript check is necessary.
4. Never run `pnpm build` unless asked or something type error or issue come in project which may affect build.
5. Run focused checks for affected shared modules.
6. Finish with `git diff --check` and `git status --short`; inspect all changed and untracked files.

For documentation-only changes, review the diff and verify that documented paths and commands exist; code builds are unnecessary. Never claim a check passed unless it was run, and report any failure or environment blocker exactly.

## Security and Configuration

- Never hardcode credentials or commit populated `.env` files. Document new variables with empty or non-sensitive values in the root `.env.example`.
- Treat browser input, route input, headers, stored JSON, and third-party responses as untrusted.
- Enforce authentication and authorization on the server; a hidden UI control is not an access boundary.
- Do not log secrets, tokens, full financial records, or unnecessary personal data.

## Commit and Pull Request Guidelines

Use short imperative commit subjects; `feat:`, `fix:`, and `chore:` prefixes are preferred but not required. Pull requests should name affected route scopes and modules, link relevant issues, list verification commands, include screenshots for visible UI changes, and call out environment or database changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
