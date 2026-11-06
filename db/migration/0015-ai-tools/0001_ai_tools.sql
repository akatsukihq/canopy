BEGIN;

-- Admin-defined custom tools (HTTP request templates and Piston code) and their attachment to agents.
-- Attachment inputs hold each agent's values; secret values are AES-GCM encrypted. Safe to re-run.
CREATE TABLE IF NOT EXISTS ai_tools (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CONSTRAINT ai_tools_kind_check CHECK (kind IN ('http','code')),
  args_schema JSONB NOT NULL CONSTRAINT ai_tools_args_schema_check CHECK (jsonb_typeof(args_schema) = 'object'),
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  http JSONB,
  code JSONB,
  output JSONB NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_tools_config_check CHECK (
    (kind = 'http' AND http IS NOT NULL AND code IS NULL) OR (kind = 'code' AND code IS NOT NULL AND http IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS ai_agent_tools (
  agent_id TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL REFERENCES ai_tools(id) ON DELETE RESTRICT,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb CONSTRAINT ai_agent_tools_inputs_check CHECK (jsonb_typeof(inputs) = 'object'),
  PRIMARY KEY (agent_id, tool_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_tools_tool_id_idx ON ai_agent_tools (tool_id);

COMMIT;
