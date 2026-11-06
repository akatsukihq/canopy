# AI Tool Connections + OpenAPI Import — Design

Date: 2026-11-06
Status: Approved in chat
Builds on: `2026-11-06-ai-custom-tools-design.md`

## Goal

One API, many endpoints, one shared config — like an MCP server with many tools. A **connection** holds the
base URL, shared inputs/secrets and default headers. Each endpoint is an ordinary HTTP custom tool that
belongs to the connection and stores only its method, path, query/body, arguments and output. Connections
can be created from an OpenAPI 3.x document.

Out of scope: re-import/sync, import from URL, Swagger 2, OAuth, header parameters.

## Data model

`ai_tool_connections`: `id`, `key` (unique, `^[a-z][a-z0-9_]*$`), `name`, `description`, `base_url`
(template: fixed `https://host[/prefix]` or one leading `{{inputs.<urlInput>}}`), `inputs`
(`ToolInputField[]`, same rules as tools), `headers` (templated, `{{inputs.*}}` only), `enabled`, timestamps.

`ai_tools.connection_id` nullable fk → connections, `on delete restrict`. A connection tool:
kind `http`, `inputs = []`, `http.url` is a path starting with `/`, may use `{{args.*}}` and the connection's
`{{inputs.*}}`. Its headers override the connection's on the same name (case-insensitive).

`ai_agent_connections (agent_id, connection_id, inputs)`: one row per agent per connection. Secrets
AES-GCM encrypted with AAD `conn:<agent>:<connection>:<field>`. Enabled endpoints stay rows in
`ai_agent_tools` with `{}` inputs.

## Runtime

`bindConnection(tool, connection)` (pure) returns an ordinary `CustomTool`: url = base + path, headers merged,
inputs = connection inputs. Disabled connection ⇒ tool treated as disabled. The runner, templating, SSRF
guard, output pipeline and Test panel are unchanged.

Templating: a query value that is exactly one `{{args.*}}` placeholder with no value is omitted; a body that is
exactly one `{{args.*}}` placeholder with no value sends no body.

## Rules

- Saving an agent: each attached connection tool needs that connection's attachment; a connection
  attachment without an attached endpoint is rejected.
- Deleting a connection is blocked while it has tools.
- Approval rule (blog generation) unchanged — it is per tool.

## OpenAPI import

Input: pasted text or uploaded file, JSON or YAML (`js-yaml`). OpenAPI 3.0/3.1 only.

| Spec | Becomes |
| --- | --- |
| `info.title` / `info.description` | connection name / description |
| `servers[0].url`, absolute https | fixed base URL |
| other / missing server | `baseUrl` URL input; base `{{inputs.baseUrl}}` |
| `apiKey` in header / query | secret input + connection header / a query entry on every imported tool |
| `http` bearer | secret input + `Authorization: Bearer {{inputs.<id>}}` |
| basic / oauth2 / openIdConnect | warning only |
| operation | tool |

Operation → tool: key = connection key + `_` + snake(operationId) (fallback method + path), deduped, ≤ 48
chars; name = summary or `METHOD path`; description = summary + description (≤ 1000); args: path + query
params, JSON request body as `body`; header/cookie params skipped with a warning; non-GET requires approval.
Schemas: local `$ref` inlined (cycle / depth 6 → `{}`), keywords filtered to an allowlist, `nullable` →
`anyOf [.., null]`. Operations whose args schema still fails validation are reported and skipped.

Flow: paste/upload → preview (connection + operation checkboxes + warnings) → create connection and selected
tools in one transaction.

## UI

- Tools list: connection groups with nested endpoints, then standalone tools. Actions: New tool, New
  connection, Import OpenAPI.
- Connection editor: Name/Key/Description, Base URL bar, tabs Endpoints | Inputs | Secrets | Headers.
- Tool editor for a connection tool: base URL chip before the path, no kind switch, Inputs/Secrets tabs
  replaced by a link to the connection.
- Agent editor: one card per connection: inputs once, then a checkbox per endpoint.

## Tests

OpenAPI mapper (refs, cycles, keyword filter, key dedupe, security schemes), `bindConnection`, optional
query/body omission, connection attachment encode/decode.
