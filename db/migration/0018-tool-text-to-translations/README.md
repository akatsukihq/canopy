# Tool text moves to translations

SEO title, SEO description, keywords and page content (how to use, limitations, FAQs,
example labels) are edited only on **Tools → a tool → Translations**, English included.
`tool_content` keeps non-text settings (category, related tools).

```sh
pnpm db:migrate 0018-tool-text-to-translations --env <name>
```

The migration copies the live (published) `tool_content` text into `translations.en`.
It only adds English keys that are missing and never overwrites an existing value, so
re-running it is safe. It does not change other languages' status, and it leaves the
`tool_content` text columns in place.

Run these read-only queries first. Restart application instances afterwards.

Published text that differs from English (review by hand; the migration leaves these):

```sql
SELECT c.tool_id, c.seo_title, t.translations -> 'en' -> 'messages' ->> 'seoTitle' AS english_title
FROM tool_content c JOIN managed_tools t USING (tool_id)
WHERE c.published_at IS NOT NULL AND btrim(coalesce(c.seo_title, '')) <> ''
  AND c.seo_title IS DISTINCT FROM t.translations -> 'en' -> 'messages' ->> 'seoTitle';
```

Unpublished drafts (never live, not copied; copy by hand if you still want them):

```sql
SELECT tool_id FROM tool_content
WHERE published_at IS NULL
  AND (seo_title IS NOT NULL OR seo_description IS NOT NULL OR keywords IS NOT NULL OR content_doc IS NOT NULL);
```
