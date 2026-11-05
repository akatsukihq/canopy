# Embedded tool translations

> **Superseded.** Tool definitions and translations now live only in the
> database (`docs/tools-in-database.md`). `definition.ts`, the `translations.json`
> snapshots for tools, `db/scripts/seed-tool-translations.mjs`,
> `db/scripts/tool-translations.mjs` and `pnpm db:translations` were removed.
> The commands below are kept as the history of this migration.

Run against the intended application database before deploying the localized catalog:

```sh
pnpm db:migrate 0003-tool-translations
node db/scripts/seed-tool-translations.mjs
```

The migration adds `managed_tools.translations`; it creates no translation table.
The translation backfill initializes English from each deployed definition and
its currently published database content. It fills missing English keys, removes
retired English keys, preserves saved values for retained keys and translated
messages, and sends other languages back to draft when the source key set changes.
Paperwork tools also receive the message contract for their existing workspace.
Other tools without a deployed definition initially receive their stored name
and description; later seeding adds their deployed fields.

It does not create tools, seed invoice templates, or upload icon assets.
Both commands load `.env.local`, then `.env`, with
explicit shell variables taking precedence. Restart running application instances
after applying the migration.

In **Admin → Tools → a tool → Translations**, complete a language's text and publish
it to expose its public page. Saving a draft removes that language from publication.
English must remain published while the tool is enabled. Enabling a tool validates
its complete English dictionary against the deployed definition. The editor shows
current fields; republishing removes retired keys from that language. Existing Catalog & SEO
and Content document changes synchronize affected English text and require other
languages to be reviewed again. A stale editing session is rejected rather than
overwriting a newer save.

Tool translations are authored in the database. The backfill initializes English;
it does not invent or publish other languages. The public shell supports English,
Hindi, Spanish, French, German, Brazilian Portuguese, Arabic, Simplified Chinese,
Japanese and Russian. Untranslated tools remain discoverable through their English
URL until a complete translation is published.

English translation saves preserve unpublished Content document drafts and example
inputs/settings. Publishing or discarding a content draft remains its own action.
This branch still loads trusted execution definitions from code; carry the same
embedded translations field forward when those definitions move to the database.

## Reviewable snapshots and production import

Translations are also checked in as `translations.json` next to their tool:

- Devtools and Media: `tools/<definition-key>/translations.json`.
- Paperwork: each tool's existing folder under `app/paperwork/components`;
  the invoice generator snapshot is in `app/paperwork/components/translations.json`,
  beside its shared `App.tsx` implementation.
- Tools without an implementation in this checkout:
  `db/seed-data/tool-translations/<tool-id>/translations.json`.

Each file contains the stable `toolId` and the database's exact `translations`
object: language, publication status, and message values. English is included
to verify the source during import. These are portable snapshots; public pages
continue to read the database, and normal seeding does not import these files.

Refresh the snapshots after editing translations in Admin, then validate them:

```sh
pnpm db:translations export
pnpm db:translations validate
```

Export reads the configured database and overwrites the corresponding local
snapshots. Validation is offline and checks every locale's keys, ICU syntax,
placeholders, and publication requirements. Use `--tool devtools.json-formatter`
with any command to limit it to one stable tool ID.

For production, run the migration and English backfill shown above using the
matching release's code before exposing its localized pages. Supply the target
`DATABASE_URL` through your deployment environment or secret manager; explicit
environment values override local files.
Preview the import before applying it:

```sh
pnpm db:translations import
pnpm db:translations import --apply
```

The first command is a dry run. Apply fills only missing language records in one
transaction. Existing English and translations, including admin-edited drafts,
are preserved. Existing language differences are reported as preserved, not
silently replaced. If a matched tool's English text or keys differ from the
snapshot, import stops before writing: reconcile that source first rather than
publishing translations for different text. Unmatched tool IDs are reported and
skipped; this command never creates tools. Re-running a successful import is safe.

The current snapshots cover 168 tool records and all ten configured languages.
Thirteen records have metadata only; their name and description translations
cannot replace the translation contract of a future implementation. When that
implementation is added, move its snapshot to the real tool folder, backfill its
English contract, complete the new translations in Admin, and export again.
