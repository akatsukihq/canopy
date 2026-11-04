BEGIN;

-- The tool definition (formerly tools/<key>/definition.ts) lives on its row.
ALTER TABLE managed_tools ADD COLUMN IF NOT EXISTS spec JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'managed_tools_spec_object_check'
      AND conrelid = 'managed_tools'::regclass
  ) THEN
    ALTER TABLE managed_tools ADD CONSTRAINT managed_tools_spec_object_check
      CHECK (spec IS NULL OR jsonb_typeof(spec) = 'object');
  END IF;
END;
$$;

-- Platform-wide caps. A tool's own limits are clamped to these at runtime
-- and rejected on save when they exceed them. Managed only in Admin.
CREATE TABLE IF NOT EXISTS system_limits (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  value BIGINT NOT NULL CHECK (value > 0),
  unit TEXT NOT NULL CHECK (unit IN ('bytes', 'chars', 'count', 'px')),
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed values match lib/tool-framework/limits.ts at the time of the move.
-- Re-running keeps values an administrator has changed.
INSERT INTO system_limits (key, value, unit, description) VALUES
  ('platform_max_bytes', 104857600, 'bytes', 'Largest input file and largest total input/output for one job.'),
  ('blob_fallback_max_bytes', 16777216, 'bytes', 'Largest output kept in memory when the browser has no private file storage.'),
  ('max_editable_text_chars', 2000000, 'chars', 'Longest text that stays editable; larger text files open read-only.'),
  ('large_text_preview_bytes', 262144, 'bytes', 'Size of the read-only preview shown for a large text file.'),
  ('csv_preview_rows', 1000, 'count', 'Rows shown in a CSV preview.'),
  ('csv_preview_bytes', 2097152, 'bytes', 'Text kept for a CSV preview.'),
  ('csv_max_field_bytes', 8388608, 'bytes', 'Largest single CSV field.'),
  ('csv_max_row_bytes', 16777216, 'bytes', 'Largest single CSV row.'),
  ('pdf_thumbnail_cache_size', 24, 'count', 'PDF page thumbnails kept in memory.'),
  ('pdf_preview_max_width', 4096, 'px', 'Widest rendered PDF preview page.'),
  ('pdf_preview_max_pixels', 8000000, 'px', 'Most pixels in one rendered PDF preview page.'),
  ('pdf_preview_cache_pixels', 32000000, 'px', 'Most pixels kept across cached PDF preview pages.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
