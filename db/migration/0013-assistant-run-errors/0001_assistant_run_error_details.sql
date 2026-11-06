BEGIN;

-- Server-only diagnostics for failed assistant runs: the real error, its cause
-- and any failed tool calls. error_message stays the user-facing text; this
-- column is never returned to the browser. Safe to re-run.
ALTER TABLE assistant_runs ADD COLUMN IF NOT EXISTS error_details JSONB;

COMMIT;
