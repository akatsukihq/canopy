BEGIN;

-- Admin-authored SEO text and page content now live only in managed_tools.translations
-- (English included). This copies what tool_content serves live into translations.en.
--
-- Safe to re-run:
--   * only published tool_content rows are read (an unpublished row was never live);
--   * only English keys that are MISSING are added; an existing English value is never
--     overwritten, so edits made on the Translations tab win;
--   * other languages' status is not changed.
-- tool_content columns are left in place; a later migration can drop them.

-- Same escaping as escapeToolText() in lib/tool-framework/translations.ts.
CREATE OR REPLACE FUNCTION pg_temp.esc(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace($1, '''', ''''''), '{', '''{'''), '}', '''}'''), '<', '''<''')
$$;

CREATE TEMP TABLE _text_keys ON COMMIT DROP AS
WITH live AS (
  SELECT c.tool_id, c.seo_title, c.seo_description, c.keywords, c.content_doc
  FROM tool_content c
  JOIN managed_tools t ON t.tool_id = c.tool_id
  WHERE c.published_at IS NOT NULL
    AND jsonb_typeof(t.translations -> 'en' -> 'messages') = 'object'
),
-- Stored content doc is used only when resolveContent() would accept it.
doc AS (
  SELECT tool_id, content_doc AS d
  FROM live
  WHERE jsonb_typeof(content_doc) = 'object'
    AND content_doc ->> 'version' = '1'
    AND jsonb_typeof(content_doc -> 'howToUse') = 'array'
)
SELECT tool_id, 'seoTitle' AS key, btrim(seo_title) AS value FROM live WHERE btrim(seo_title) <> ''
UNION ALL
SELECT tool_id, 'seoDescription', btrim(seo_description) FROM live WHERE btrim(seo_description) <> ''
UNION ALL
SELECT tool_id, 'keywords.' || (k.i - 1), k.v
FROM live,
  LATERAL (
    SELECT btrim(u.v) AS v, row_number() OVER (ORDER BY u.ord) AS i
    FROM unnest(live.keywords) WITH ORDINALITY AS u(v, ord)
    WHERE btrim(u.v) <> ''
  ) k
UNION ALL
SELECT tool_id, 'content.howToUse.' || (e.ord - 1), e.v
FROM doc, jsonb_array_elements_text(d -> 'howToUse') WITH ORDINALITY AS e(v, ord)
UNION ALL
SELECT tool_id, 'content.limitations.' || (e.ord - 1), e.v
FROM doc, jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(d -> 'limitations') = 'array' THEN d -> 'limitations' ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(v, ord)
UNION ALL
SELECT tool_id, 'content.faq.' || (e.ord - 1) || '.q', e.v ->> 'q'
FROM doc, jsonb_array_elements(
  CASE WHEN jsonb_typeof(d -> 'faq') = 'array' THEN d -> 'faq' ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(v, ord)
UNION ALL
SELECT tool_id, 'content.faq.' || (e.ord - 1) || '.a', e.v ->> 'a'
FROM doc, jsonb_array_elements(
  CASE WHEN jsonb_typeof(d -> 'faq') = 'array' THEN d -> 'faq' ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(v, ord)
UNION ALL
SELECT tool_id, 'content.examples.' || (e.ord - 1) || '.label', e.v ->> 'label'
FROM doc, jsonb_array_elements(
  CASE WHEN jsonb_typeof(d -> 'examples') = 'array' THEN d -> 'examples' ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(v, ord);

UPDATE managed_tools t
SET translations = jsonb_set(
      t.translations,
      '{en,messages}',
      t.translations -> 'en' -> 'messages' || missing.messages
    ),
    updated_at = now()
FROM (
  SELECT k.tool_id, jsonb_object_agg(k.key, to_jsonb(pg_temp.esc(k.value))) AS messages
  FROM _text_keys k
  JOIN managed_tools m ON m.tool_id = k.tool_id
  WHERE k.value IS NOT NULL
    AND NOT (m.translations -> 'en' -> 'messages' ? k.key)
  GROUP BY k.tool_id
) missing
WHERE t.tool_id = missing.tool_id;

COMMIT;
