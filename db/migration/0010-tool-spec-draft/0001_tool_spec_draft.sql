BEGIN;

-- An unpublished edit of managed_tools.spec. The public catalogue only reads
-- spec; Admin publishes a draft by copying it there. JSON, not JSONB, for the
-- same key-order reason as spec.
ALTER TABLE managed_tools ADD COLUMN IF NOT EXISTS spec_draft JSON;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'managed_tools_spec_draft_object_check'
      AND conrelid = 'managed_tools'::regclass
  ) THEN
    ALTER TABLE managed_tools ADD CONSTRAINT managed_tools_spec_draft_object_check
      CHECK (spec_draft IS NULL OR json_typeof(spec_draft) = 'object');
  END IF;
END;
$$;

COMMIT;
