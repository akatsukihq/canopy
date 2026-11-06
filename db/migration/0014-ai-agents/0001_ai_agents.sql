BEGIN;

-- Admin-configured AI agents, their skills (loaded on demand) and remote MCP
-- servers. Seed rows reproducing the former hardcoded agents are inserted by
-- 0002_seed_ai_agents.sql. Safe to re-run.
CREATE TABLE IF NOT EXISTS ai_skills (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'http' CONSTRAINT ai_mcp_servers_transport_check CHECK (transport IN ('http','sse')),
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  command TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  persona TEXT NOT NULL,
  model TEXT,
  effort TEXT NOT NULL DEFAULT 'medium' CONSTRAINT ai_agents_effort_check CHECK (effort IN ('low','medium','high','xhigh','max')),
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_schema JSONB CONSTRAINT ai_agents_output_schema_check CHECK (output_schema IS NULL OR jsonb_typeof(output_schema) = 'object'),
  proposes_document BOOLEAN NOT NULL DEFAULT false,
  requires_document BOOLEAN NOT NULL DEFAULT false,
  web_search BOOLEAN NOT NULL DEFAULT false,
  builtin_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  mcp_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  subagents JSONB NOT NULL DEFAULT '{"mode":"none","agentIds":[]}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
