BEGIN;

-- Connections: one API's shared base URL, inputs/secrets and headers; its endpoints are ai_tools rows.
-- Each agent stores its connection values once in ai_agent_connections (secrets AES-GCM encrypted). Safe to re-run.
CREATE TABLE IF NOT EXISTS ai_tool_connections (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_tools ADD COLUMN IF NOT EXISTS connection_id TEXT REFERENCES ai_tool_connections(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS ai_tools_connection_id_idx ON ai_tools (connection_id);

CREATE TABLE IF NOT EXISTS ai_agent_connections (
  agent_id TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES ai_tool_connections(id) ON DELETE RESTRICT,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb CONSTRAINT ai_agent_connections_inputs_check CHECK (jsonb_typeof(inputs) = 'object'),
  PRIMARY KEY (agent_id, connection_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_connections_connection_id_idx ON ai_agent_connections (connection_id);

-- Shared secret values set on the tool or connection itself (field id → encrypted StoredSecret). An agent's own
-- value overrides it. Never sent to the browser.
ALTER TABLE ai_tools ADD COLUMN IF NOT EXISTS secret_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_tool_connections ADD COLUMN IF NOT EXISTS secret_values JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
