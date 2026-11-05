BEGIN;

-- Admin overrides for an allowlist of environment settings (see
-- lib/config/runtimeSettings.ts). A row wins over the env default; deleting
-- the row reverts to env.
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

COMMIT;
