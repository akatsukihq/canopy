# Tools in the Database: Definitions, Translations, AI Helper

Status: in progress · 2026-11-04

Done on `feat/tools-in-database`: `managed_tools.spec` + `system_limits`
(migration `0009-tool-spec`); loaders read `spec`; strict validator
`parseToolSpec` (`lib/tool-framework/specSchema.ts`) on every load; `canopy` CLI
(`tool new`); every `definition.ts`, tool `translations.json`,
the tool seed and the snapshot scripts deleted (they remain in git history);
`managed_tools.spec_draft` (migration `0010-tool-spec-draft`) with save draft /
publish / discard; Admin Definition editor and draft preview; `tool sql` removed;
`{name}` placeholder chips in the Definition and Translations editors; icons
served from `tools/<key>/icon.svg` (`scripts/copy-tool-icons.mjs`, run by
`prepare:vendor` and `postinstall`); Admin → Settings: all 12 `system_limits`
editable below their code ceilings, tools over a lowered limit listed, and
Runtime overrides in `platform_settings` (migration `0011-platform-settings`,
`lib/config/runtimeSettings.ts`).

Open: the tool AI assistant is being widened from Translations to every tool
section (content/SEO, Definition, Translations); `invoice-generator.svg` has no
owner folder yet; no LFS archive was made (git history holds the deleted files).

## Admin settings

`/admin/settings` needs the `settings` permission (`view`, `edit`).

- **System limits** — every edit is checked against the code ceiling in
  `lib/tool-framework/limits.ts`, rejected if stale, audited
  (`system-limit.edit`), and clears the catalog cache.
- **Runtime settings** — each Settings section is its own route
  (`/admin/settings/<limits|ai|email|uploads|integrations|traffic>`), listed as
  nested items under Settings in the sidebar. Each page has one Save for all its
  changes, written in a single transaction (a rejected value saves nothing). The
  env or code value is the default; "Use default" deletes the override. Audited
  as `platform-setting.edit`; secrets are audited as `[secret]`, never by value.
- **Providers** — AI (OpenAI, Anthropic) and email (Cloudflare, Resend, SMTP)
  each keep their own saved key and settings. "Make active" (with a confirm)
  switches `ai.provider` / `email.provider`, and is allowed only when that
  provider's required settings have values (`PROVIDER_CHOICES`). AI "Test & load
  models" lists models the key can use; email "Send test email" verifies saved
  credentials and mails the signed-in admin. Consumers read credentials per
  request (`lib/config/integrations.ts`), so switching needs no redeploy.
- **Secrets** — API keys saved in Admin are AES-256-GCM encrypted with
  `SETTINGS_ENCRYPTION_KEY` (32+ chars, setting key as AAD) and never sent back
  to the browser. Without that env var, keys can only come from env. Changing
  the key makes saved secrets unreadable (they fall back to env); re-enter them.
- Env-only configuration (database, Redis, auth, OAuth, analytics, Cloudinary
  cloud name) is not shown in Admin; it cannot be changed there.

## Summary

Every tool's definition and translations live only in the database. The 163
`tools/<key>/definition.ts` files and the 183 `translations.json` files are
removed (after an LFS archive). A tool folder keeps only code and its icon:
`run.ts` / `run.worker.ts`, `workspace.tsx`, tests, and `icon.svg`.

- **Definition** (identity, input, settings, trigger, capabilities, labels,
  content, messages) → new `managed_tools.spec` JSON column, edited in Admin.
- **Translations** → `managed_tools.translations` (unchanged). English is still
  derived from the spec with the existing `extractToolMessages`.
- **Release to production** → a generated SQL script per tool, run directly in prod.
- **AI helper** → right-side assistant on the Translations page that suggests
  text when an admin asks. Admin saves and publishes.
- **App start** → reads only the DB. No seeding, no folder scanning.

## Current state

| Piece | Where | Role today |
| --- | --- | --- |
| Definition | `tools/<key>/definition.ts` (163), loaded by `loadSpec()` in `lib/tool-framework/catalog.ts` via dynamic import | Behaviour contract + English copy |
| Tool rows | `managed_tools`, `tool_content` | Identity, slug, order, enabled, translations, SEO/content overrides |
| Runtime translations | `managed_tools.translations` | Source of truth for public pages |
| Seeding | `db/seedManagedTools.ts` via `pnpm db:seed` | Creates rows + English from definitions |
| Snapshots | 183 `translations.json`, `db/scripts/tool-translations.mjs` | Export/import copies only |
| Icons | `scripts/seed-assets/tool-icons/*.svg` (166) → Cloudinary → `icon_url` | Uploaded by `db:seed` |
| Assistant | `lib/assistant/*`, registry `app/api/assistant/integrations.ts` | Only blog registered |

## Target data model

Migration `0009-tool-spec`:

- `managed_tools.spec json` (not jsonb: jsonb reorders keys, and `settings.fields` order is render order) — the full `ToolSpec` that `definition.ts` exports
  today (`toolId`, `app`, `category`, `input`, `settings`, `trigger`,
  `capabilities`, `sharing`, `workbenchMark`, `labels`, `content`, `messages`, …).
- `loadSpec(definitionKey)` reads `spec` from the row instead of importing a file.
- "Code has shipped" check becomes: `tools/<key>/run` (or `run.worker`) imports.
- Saving a spec regenerates English in `translations.en` with the existing
  backfill rules (keep admin-edited English that still fits; other languages go
  back to draft when source keys change).

**Decision: no per-tool code bounds; limits come from a DB system-limits table.**
Setting values, defaults and capabilities in `spec` are trusted as-is. Size and
count limits are capped by `system_limits`.

### System limits

Migration `0009-tool-spec` also adds `system_limits`, seeded with today's values
from `lib/tool-framework/limits.ts`:

| Key | Seed value | Caps |
| --- | --- | --- |
| `platform_max_bytes` | 100 MiB | `acceptFiles.maxBytes`, one job's total I/O |
| `blob_fallback_max_bytes` | 16 MiB | Output held in memory without OPFS |
| `max_editable_text_chars` | 2,000,000 | `input.maxLength`, `acceptFiles.maxEditableBytes` |
| `large_text_preview_bytes` | 256 KiB | Read-only large-file preview |
| `csv_preview_rows` / `csv_preview_bytes` | 1,000 / 2 MiB | CSV preview |
| `csv_max_field_bytes` / `csv_max_row_bytes` | 8 MiB / 16 MiB | Streaming CSV |
| `pdf_thumbnail_cache_size`, `pdf_preview_max_width`, `pdf_preview_max_pixels`, `pdf_preview_cache_pixels` | 24, 4096, 8 M, 32 M | PDF preview |

Columns: `key` (PK), `value` (bigint), `unit` (`bytes` / `chars` / `count` / `px`),
`description`, `updated_at`. Edited in Admin → System limits.

Rules:

- **On spec save:** a tool limit above its system limit is rejected with the
  field name and the cap (for example `input.maxLength 3,000,000 exceeds
  max_editable_text_chars 2,000,000`).
- **At runtime:** effective limit = the smaller of the tool's value and the
  system limit, so a spec written by raw SQL still cannot exceed it.
- **Delivery:** the server loads limits once per request (cached like the
  catalog), resolves them to `RuntimeLimits` and passes them to `ToolPage`,
  which installs them with `setRuntimeLimits`; every worker job and inspection
  message carries them and the worker installs them before running. Code
  reads `getRuntimeLimits()` at call time.
- **Ceilings:** the constants in `lib/tool-framework/limits.ts` are both the
  fallback (no database, missing or invalid row) and the hard ceiling; Admin
  rejects a value above its ceiling and the runtime caps it anyway.
- **Lowering a system limit** does not rewrite specs; runtime clamping applies
  at once, and Admin lists tools whose spec now exceeds the cap.
- `PROGRESS_INTERVAL_MS` and `CANCEL_WATCHDOG_MS` are timing internals, not
  limits; they stay in code.

> **Risk, accepted:** setting values and defaults are not checked against code.
> Renaming the choice value `"tab"` breaks `run.ts`. Spec saves keep a structural
> check of the `ToolSpec` shape so malformed JSON cannot take down a public page.

## Developer flow (new tool)

| Step | Command / action | Result |
| --- | --- | --- |
| 1. Scaffold | `pnpm tool:new <key> --category <category> [--app media] [--runtime worker\|server]` | `tools/<key>/` with the run file and `icon.svg`; inserts a disabled row with a starter spec into the local DB (`DATABASE_URL`) |
| 2. Build | Edit code; edit the spec in local Admin → tool → Definition (form or JSON view), Save draft, Preview draft, Publish | Tool runs locally from the local DB |
| 3. Translate (optional locally) | Local Admin → Translations, AI helper if wanted | Local drafts |
| 4. Export | Local Admin → Definition → Copy JSON | The spec as JSON |
| 5. Release | Deploy code. Prod Admin → New tool → Import JSON (new tool), or the tool's Definition → Import JSON → Save draft (existing tool) | Prod row with the spec as an unpublished draft |
| 6. Go live | Prod Admin: Preview draft, Publish, translate other languages with the AI helper's suggestions, enable | Admin owns every published word |
| Local copy of prod | `pnpm db:copy` (exists), prod → local | Fresh local DB with all tools |

`pnpm db:seed` no longer creates tools. A fresh local DB comes from `pnpm db:copy`.
`db:seed` keeps invoice templates.

## Spec drafts

`managed_tools.spec` is what visitors get; `spec_draft` is an admin's
unpublished edit (`lib/admin/toolSpecDraft.ts`). All three actions need the
`tools` edit permission, lock the row, reject a stale `updatedAt`, and are audited.

- **Save draft** — `parseToolSpec`, `toolId`/`app` must match the row, and
  `limitViolations` must be empty. The raw JSON is stored, keeping key order.
- **Publish** — re-validates, copies the draft to `spec`, clears it, and syncs
  English with the existing rules (other languages go back to draft when their
  source keys change).
- **Discard** — clears the draft.

`/admin/tools/<toolId>/preview` runs `ToolPage` with the draft (or the published
spec when there is none), English only, `noindex`, uncached.

The `canopy` CLI (`packages/cli`) has only `canopy tool new`; it imports no app
code except the category registry, so it can be published later.

## Icons

Each tool's icon moves to `tools/<key>/icon.svg`; paperwork icons move to their
folder under `app/paperwork/components/`. They are copied to `public/tool-icons/`
at `dev`/`build` time and served as static files (see Decisions 2). The release
SQL carries no icon URL.

## AI translation helper

The helper assists the admin; it does not translate on its own.

- **Where:** right-side `AssistantPanel` on Admin → Tools → a tool → Translations,
  registered as `tool-translations` next to `blog`.
- **Asks it handles:** suggest text for selected empty fields, give alternatives
  for one string, fix placeholder/plural issues, explain what a string means,
  fill missing fields for one language when explicitly asked.
- **Context:** this tool's English messages, current values for the language in
  question, the admin's selected fields. No other tools.
- **Output:** per-field suggestions in `ChangesetPreview`, each checked with
  `validateToolTranslation`; invalid suggestions show their error and cannot be applied.
- **Accept:** fills the form field only, unsaved. Admin saves draft / publishes.
- **Never:** saves, publishes, edits English, touches other tools, runs unasked.
  No "translate everything" button.

## One-time migration

1. Archive into LFS (`db/archive/*.tar.gz` in `.gitattributes`):
   all `definition.ts`, all `translations.json`, and `scripts/seed-assets/tool-icons/`.
2. Migration `0009-tool-spec` adds `managed_tools.spec`.
3. `pnpm tool:sql --all --from-code --update` (last use of the definition files)
   generates one SQL file that writes every definition into `spec`. Run it on
   local, then prod.
4. Switch `loadSpec`, manifest, catalog, admin and `tool:new` to the DB.
5. Delete `definition.ts` files, `translations.json` files, `db/seed-data/tool-translations/`,
   `db/scripts/tool-translations.mjs`, `db/scripts/seed-tool-translations.mjs`,
   the definition scan in `db/seedManagedTools.ts`, the `db:translations` script,
   `tests/tool-translation-snapshots.test.mjs`. Move icons into tool folders.
6. Update `tools/AGENTS.md` (the "Code owns executable…" rule, Public
   translations), the `0003` README, `README.md` seeding notes.
7. After production is verified, delete the archive in a follow-up commit.

## Decisions

1. **Tests.** 39 test files read definitions today.
   - Unit tests of `run.ts` / workspace logic pass the spec values they need
     inline. They test code, so they must not depend on whatever text a database holds.
   - Tests that need real stored specs read them read-only from the local dev
     database (`tests/helpers/toolSpec.mjs`: `toolSpec(key)`, `allToolSpecs()`).
2. **Icons are served from the tool folders, no Cloudinary.** A prepare step
   (like `prepare:vendor`) copies `tools/<key>/icon.svg` to `public/tool-icons/<key>.svg`
   (gitignored) before `dev` and `build`. Next and the Cloudflare build serve them as
   static files at `/tool-icons/<key>.svg`. The catalog derives the URL from the key;
   `icon_url` and the Cloudinary upload scripts are retired for tools with a folder.
3. **Folderless tools** (13 metadata-only records): out of scope, ongoing work.
4. **Spec editor:** both a form view and a JSON view, on the same spec, each
   shape-checked and checked against system limits on save.
5. The 13 seed-data records and the compiler translations already exist in prod.
   Work happens on a separate branch.
6. **System limits are managed only in Admin.** No SQL-script route; each
   environment's admin edits its own values.

## Implementation order

1. LFS archive.
2. Migration `0009-tool-spec` + `tool:sql --from-code` + run on local.
3. Switch loaders (`catalog.ts`, `manifest.ts`, admin) to `spec`; update tests.
4. `tool:new`; `spec_draft` + Admin Definition editor and preview (replaced the stopgap `tool:sql`).
5. Delete files and scripts; move icons; docs.
6. AI translation helper.

Verification: affected `node --test` suites, `pnpm lint`, admin pages checked
in the browser at 1366 × 768, a release SQL run against a copy of prod,
`git diff --check`.
