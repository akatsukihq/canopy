BEGIN;

-- Stored media becomes a self-describing MediaRef (lib/media):
--   {"v":1,"provider":"cloudinary","format":..,"width":..,"height":..,"uploadedAt":..,
--    "entry":{"cloudName":..,"publicId":..,"version":..}}
-- Each record keeps its own account, so switching the upload provider or cloud
-- never breaks files uploaded earlier. Safe to re-run.

CREATE OR REPLACE FUNCTION pg_temp.uri_decode(value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT convert_from(
    string_agg(
      CASE WHEN part[1] IS NOT NULL THEN decode(part[1], 'hex') ELSE convert_to(part[2], 'UTF8') END,
      ''::BYTEA ORDER BY position
    ),
    'UTF8'
  )
  FROM regexp_matches(value, '%([0-9A-Fa-f]{2})|([^%]+)', 'g') WITH ORDINALITY AS parts(part, position)
$$;

CREATE OR REPLACE FUNCTION pg_temp.media_now()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- Legacy blog image: {publicId, version, format, width, height, alt, caption[, src][, displayWidth, alignment]}.
CREATE OR REPLACE FUNCTION pg_temp.is_legacy_image(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(value) = 'object' AND value ?& ARRAY['publicId', 'version', 'format', 'width', 'height']
    AND NOT value ? 'media'
$$;

CREATE OR REPLACE FUNCTION pg_temp.convert_media(value JSONB, cloud_name TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    RETURN (SELECT coalesce(jsonb_agg(pg_temp.convert_media(item, cloud_name) ORDER BY position), '[]'::JSONB)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS items(item, position));
  END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN
    RETURN value;
  END IF;
  IF pg_temp.is_legacy_image(value) THEN
    IF cloud_name IS NULL THEN
      RAISE EXCEPTION 'Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME or CLOUDINARY_CLOUD_NAME to convert existing blog images';
    END IF;
    RETURN (value - ARRAY['publicId', 'version', 'format', 'width', 'height', 'src']) || jsonb_build_object(
      'media', jsonb_build_object(
        'v', 1,
        'provider', 'cloudinary',
        'format', value->'format',
        'width', value->'width',
        'height', value->'height',
        'uploadedAt', pg_temp.media_now(),
        'entry', jsonb_build_object('cloudName', cloud_name, 'publicId', value->'publicId', 'version', value->'version')
      )
    );
  END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(key, pg_temp.convert_media(item, cloud_name)), '{}'::JSONB)
    FROM jsonb_each(value) AS fields(key, item));
END;
$$;

DO $$
DECLARE
  cloud_name TEXT := nullif(btrim(current_setting('canopy.cloudinary_cloud_name', true)), '');
  pattern TEXT := '^https://res\.cloudinary\.com/([^/]+)/image/upload/f_png,c_fill,w_256,h_256,q_auto/v([0-9]+)/(.+)\.png$';
  unconverted TEXT;
BEGIN
  -- Tool icons: icon_url TEXT -> icon JSONB.
  ALTER TABLE managed_tools ADD COLUMN IF NOT EXISTS icon JSONB;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'managed_tools'::REGCLASS AND attname = 'icon_url' AND NOT attisdropped
  ) THEN
    LOCK TABLE managed_tools IN SHARE ROW EXCLUSIVE MODE;
    UPDATE managed_tools AS tools
    SET icon = jsonb_build_object(
      'v', 1,
      'provider', 'cloudinary',
      'format', 'png',
      'width', 256,
      'height', 256,
      'uploadedAt', pg_temp.media_now(),
      'entry', jsonb_build_object(
        'cloudName', pg_temp.uri_decode(parts[1]),
        'publicId', (
          SELECT string_agg(pg_temp.uri_decode(segment), '/' ORDER BY position)
          FROM unnest(string_to_array(parts[3], '/')) WITH ORDINALITY AS segments(segment, position)
        ),
        'version', parts[2]::BIGINT
      )
    )
    FROM (SELECT tool_id, regexp_match(icon_url, pattern) AS parts FROM managed_tools) AS parsed
    WHERE tools.tool_id = parsed.tool_id AND tools.icon IS NULL AND parsed.parts IS NOT NULL;

    SELECT string_agg(tool_id, ', ' ORDER BY tool_id) INTO unconverted
    FROM managed_tools WHERE icon_url IS NOT NULL AND icon IS NULL;
    IF unconverted IS NOT NULL THEN
      RAISE EXCEPTION 'Tool icons are not Cloudinary uploads and cannot be converted: %. Clear icon_url for these tools and retry', unconverted;
    END IF;
    ALTER TABLE managed_tools DROP COLUMN icon_url;
  END IF;

  -- Blog images in drafts and every revision.
  UPDATE blog_posts SET draft_document = pg_temp.convert_media(draft_document, cloud_name)
  WHERE jsonb_path_exists(draft_document, 'strict $.**.publicId');
  UPDATE blog_revisions SET document = pg_temp.convert_media(document, cloud_name)
  WHERE jsonb_path_exists(document, 'strict $.**.publicId');
END;
$$;

DROP FUNCTION pg_temp.convert_media(JSONB, TEXT);
DROP FUNCTION pg_temp.is_legacy_image(JSONB);
DROP FUNCTION pg_temp.media_now();
DROP FUNCTION pg_temp.uri_decode(TEXT);
COMMIT;
