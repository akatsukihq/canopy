# AI Custom Tools — Design

Date: 2026-11-06
Status: Draft, awaiting review
Builds on: `2026-11-05-ai-agents-design.md`

## Goal

Admins define their own tools (like Chatbase Actions / Neo HTTP skills) and attach them to AI agents.
Two kinds:

- **HTTP** — calls an external API from a request template.
- **Code** — runs admin-written JavaScript or Python on the existing Piston engine (`lib/code-execution`).

A tool is a **template**. Each agent that attaches it supplies its own **inputs** (API key, base URL, …),
following Neo's skill + action split. Write calls can require user approval before they run.

Out of scope: client-side (browser) tools, OAuth flows, MCP changes, a marketplace of shared tools.

## Data model

### `ai_tools` (template)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text pk | nanoid |
| `key` | text unique | `^[a-z][a-z0-9_]*$`, becomes the model-facing tool name `custom_<key>` |
| `name` | text | admin label |
| `description` | text | model-facing; decides when the model calls it (≤ 1000 chars) |
| `kind` | `http` \| `code` | |
| `args_schema` | jsonb | JSON Schema, root `{ "type": "object" }`, validated with `outputSchemaSchema`'s rules (z.fromJSONSchema parse, size limit, unenforced keywords rejected) |
| `inputs` | jsonb | `ToolInputField[]` — see below |
| `http` | jsonb null | `HttpToolConfig`, required when `kind = http` |
| `code` | jsonb null | `CodeToolConfig`, required when `kind = code` |
| `output` | jsonb | `ToolOutputConfig` — parser + optional schema, see Output |
| `requires_approval` | boolean | default `true` when `http.method !== "GET"`, else `false`; code tools default `false` |
| `enabled` | boolean | |
| `updated_at`, `updated_by` | | |

```ts
type ToolInputField = {
  id: string;            // ^[a-zA-Z][a-zA-Z0-9_]*$
  label: string;
  type: "text" | "secret" | "url" | "number";
  required: boolean;
  defaultValue: string | null; // never allowed for "secret"
  description: string | null;
};

type HttpToolConfig = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;                       // template, see Templating
  headers: Record<string, string>;   // values are templates
  query: Record<string, string>;     // values are templates
  body: unknown | null;              // JSON template; ignored for GET
  responsePath: string | null;       // dot path into the JSON response, e.g. "data.items"
  timeoutMs: number;                 // 1_000 – 60_000, default 15_000
};

type CodeToolConfig = {
  language: "javascript" | "python"; // keys resolved through CODE_LANGUAGES
  source: string;                    // ≤ 64 KB
};

type ToolOutputConfig = {
  parser: "auto" | "json" | "text" | "html-text" | "code";
  /** Required when parser = "code": Piston transform, stdin = raw response, stdout = parsed value. */
  transform: CodeToolConfig | null;
  /** null = freeform. Otherwise the parsed value must match; same rules as args_schema. */
  schema: Record<string, unknown> | null;
};
```

### `ai_agent_tools` (attachment)

| Column | Type | Notes |
| --- | --- | --- |
| `agent_id` | fk `ai_agents` on delete cascade | |
| `tool_id` | fk `ai_tools` on delete restrict | deleting an attached tool is blocked with a message listing the agents |
| `inputs` | jsonb | `{ [fieldId]: string }`; `secret` values AES-GCM encrypted with the existing secrets helper |
| pk | `(agent_id, tool_id)` | |

Secrets are never returned to the browser. The editor receives `{ [fieldId]: { set: boolean } }` for
secret fields; on save `null` keeps the stored value (same convention as MCP headers).

Agent `version` bumps when its attachments change.

## Templating

Placeholders: `{{args.<path>}}` (model arguments) and `{{inputs.<id>}}` (agent inputs). Nothing else.

- Substitution walks the parsed template (headers, query, body JSON) and replaces placeholders inside
  string values. A value that is exactly one placeholder takes the raw typed value (number, object…);
  otherwise it is stringified into the string.
- URL: path segments built from placeholders are `encodeURIComponent`-escaped; query values go through
  `URLSearchParams`.
- **The URL origin (scheme + host + port) must be fixed in the template or come from a single `url`-type
  input. `{{args.*}}` is rejected in the origin at save time and re-checked at runtime.**
- Resolved URL must be `https:` and pass the existing SSRF guard (same one MCP servers use), checked
  after redirects too (`redirect: "manual"`, max 3 hops, each re-checked).
- Missing required input or arg → tool returns an error result to the model, no request sent.

## Runtime

Tools join the agent's tool set in `lib/agents/compile.ts` next to built-in and MCP tools, as
`custom_<key>` with `inputSchema` from `args_schema`.

### HTTP

1. Validate args against `args_schema` (zod from JSON Schema).
2. Resolve template, SSRF-check, `fetch` with `AbortSignal.any([runSignal, timeout])`.
3. Response goes through Output (below). **No size cap** (search-style APIs return large payloads).
   If the result exceeds the model's context the run fails with the provider error, shown in the panel.
4. Non-2xx → result `{ error: { status, body } }` so the model can react; it does not fail the run.

### Code

1. Requires `readCodeExecutionConfig()`; unset → tool returns `{ error: "Code execution is not configured." }`
   and the admin editor shows the tool as unavailable.
2. Runs through the existing gate/limits in `lib/code-execution` with stdin = `JSON.stringify({ args, inputs })`.
3. stdout goes through Output (below). Non-zero exit / compile error / timeout →
   `{ error, stderr }` result.
4. Piston has no network; code tools are for compute/transform/validation only. Secrets reach code via
   stdin, never interpolated into source.

### Output

Applies to both kinds, after the raw result (HTTP body / code stdout) is read. Order: **parse → `responsePath` → schema**.

Parsers:

| Parser | Behaviour |
| --- | --- |
| `auto` (default) | JSON if `content-type` is JSON or the body parses as JSON, else text |
| `json` | must parse, else error result |
| `text` | raw string |
| `html-text` | strips tags/scripts/styles to readable text (for page-fetch / search tools) |
| `code` | runs `transform` on Piston; stdin = `{ body, status, headers }` (HTTP) or `{ stdout }` (code); stdout parsed as JSON, else text. Needs Piston configured |

Schema:

- `schema: null` → **freeform**: parsed value passed to the model as-is.
- `schema` set → parsed value validated with `z.fromJSONSchema`. Pass → validated value returned and the
  schema is also sent as the AI SDK tool `outputSchema`. Fail → error result
  `{ error: "Output did not match schema", issues }` (first 10 issues) so the model can retry or report it.
- No size cap at any stage.

The admin Test panel shows each stage: raw response, parsed value, schema result.

### Approval

Uses AI SDK 7 `needsApproval`.

- A tool with `requires_approval` pauses the run: new `AssistantRunStatus` value `awaiting-approval`,
  run stores the pending tool call (`toolCallId`, tool name, args).
- Panel shows the tool name and arguments (secret inputs never shown — they are not part of args) with
  **Approve** / **Reject**. Either starts a continuation run carrying the `ToolApprovalResponse`.
- Approval works only in interactive sections (`blog-editor`, `tool-content`). Saving an agent fails if
  an approval-required tool is reachable (directly, via delegate, or via pipeline) from an agent listed
  in `blog-generation`.
- Abandoned approvals expire with the run's existing retention; no reminder.

### Audit

Each call logs `{ runId, agentId, toolId, kind, status, durationMs }` via the observability logger.
Args, inputs and response bodies are never logged.

## Admin UI

Route: `/admin/agents/tools` (list) and `/admin/agents/tools/[id]` (editor); permission `agents.view` /
`agents.edit`. Navigation entry beside Skills and MCP servers.

Editor sections (one page, no two-column settings, field pattern: label → input → description/error):

1. **Definition** — name, key, description, kind, enabled, requires approval.
2. **Arguments** — JSON Schema editor (existing CodeEditor, JSON).
3. **Inputs** — list of input fields (add/remove/reorder).
4. **Request** (HTTP) — method, URL, headers, query, body, response path, timeout.
   **Code** — language, source (CodeEditor), note that code has no network.
5. **Output** — parser select, transform code (when parser = code), output mode Freeform / Schema with
   JSON Schema editor.
6. **Test** — sample args (JSON) + input values (secrets entered, not stored) → Run. Shows status,
   duration, HTTP status or exit code, response (SyntaxHighlight JSON in CodeBlock). Approval is skipped
   in tests. Server action, `agents.edit` only.

Agent editor: new **Custom tools** picker. Each attached tool shows its inputs form; required inputs must
be filled to save.

Errors from save/test use toast; field errors inline.

## Validation summary (save time)

- `args_schema` valid object schema; `inputs` ids unique; secret fields have no default.
- HTTP: URL template parses, origin has no `{{args.*}}`, placeholders reference declared args/inputs.
- Code: language is a known `CODE_LANGUAGES` entry; source ≤ 64 KB.
- Output: `transform` required iff parser = `code`; `schema` null or valid object schema.
- Attachment: all required inputs present; approval-in-generation rule above.

## Testing

Focused vitest suites:

- `tests/ai-tools-template.test.mjs` — substitution, typed placeholders, encoding, origin rule.
- `tests/ai-tools-runtime.test.mjs` — HTTP success/non-2xx/timeout/redirect SSRF (mocked fetch),
  code runner with mocked Piston, missing inputs, each parser, schema pass/fail, freeform passthrough.
- `tests/ai-tools-store.test.mjs` — secret encryption round-trip, keep-on-null, delete restrict,
  approval-in-generation rejection.
- Approval continuation covered in the existing assistant runs tests.

## Delivery order

1. Tables + migration, store, templating, HTTP runtime, test run, admin UI, agent attachment.
2. Code tools.
3. Approval flow (touches `lib/assistant/runs.ts`, run status, panel UI).
