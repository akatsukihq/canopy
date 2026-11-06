import { afterEach, beforeEach, expect, test, vi } from "vitest";

process.env.SETTINGS_ENCRYPTION_KEY = "test-key-that-is-at-least-32-characters-long";

vi.mock("server-only", () => ({}));
vi.mock("../lib/observability/logger.ts", () => ({ log: vi.fn(), logError: vi.fn(), errorDetails: () => ({}) }));
const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args) => lookup(...args),
  default: { lookup: (...args) => lookup(...args) },
}));

const { bindConnection, toolConnectionInputSchema } = await import("../lib/agents/toolConnections.ts");
const { previewOpenApi, cleanSchema, snake } = await import("../lib/agents/openApiImport.ts");
const { toolInputSchema } = await import("../lib/agents/toolTypes.ts");
const { encodeAttachmentInputs, decodeAttachmentInputs, encodeSharedSecrets, decodeSharedSecrets } =
  await import("../lib/agents/toolAttachments.ts");
const { runCustomTool } = await import("../lib/agents/toolRuntime.ts");

const fetchMock = vi.fn();
beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const secret = (id) => ({ id, label: id, type: "secret", required: true, defaultValue: null, description: null });
const connection = {
  key: "crm",
  name: "CRM",
  description: "",
  baseUrl: "https://api.crm.example/v1/",
  inputs: [secret("apiKey")],
  headers: { Authorization: "Bearer {{inputs.apiKey}}", Accept: "application/json" },
  enabled: true,
};
const endpoint = (http = {}, over = {}) => ({
  id: "e1",
  key: "crm_get_user",
  name: "Get user",
  description: "Gets a user",
  kind: "http",
  argsSchema: {
    type: "object",
    properties: { id: { type: "string" }, expand: { type: "string" }, body: { type: "object" } },
    required: ["id"],
  },
  inputs: [],
  http: {
    method: "GET",
    url: "/users/{{args.id}}",
    headers: { accept: "text/plain" },
    query: { expand: "{{args.expand}}" },
    body: null,
    responsePath: null,
    timeoutMs: 5000,
    ...http,
  },
  code: null,
  output: { parser: "auto", transform: null, schema: null },
  requiresApproval: false,
  enabled: true,
  connectionId: "c1",
  updatedAt: "",
  updatedBy: null,
  ...over,
});

test("bindConnection joins base URL and path, merges headers case-insensitively, and inherits inputs and enabled", () => {
  const bound = bindConnection(endpoint(), connection);
  expect(bound.http.url).toBe("https://api.crm.example/v1/users/{{args.id}}");
  expect(bound.http.headers).toEqual({ Authorization: "Bearer {{inputs.apiKey}}", accept: "text/plain" });
  expect(bound.inputs).toEqual(connection.inputs);
  expect(bindConnection(endpoint(), { ...connection, enabled: false }).enabled).toBe(false);
});

test("connection schema: origin rule, URL input type, inputs-only placeholders", () => {
  expect(toolConnectionInputSchema.safeParse(connection).success).toBe(true);
  const issues = (over) =>
    toolConnectionInputSchema.safeParse({ ...connection, ...over }).error?.issues.map((i) => i.message);
  expect(issues({ baseUrl: "http://api.crm.example" })[0]).toMatch(/https/);
  expect(issues({ baseUrl: "{{inputs.apiKey}}" })[0]).toMatch(/type URL/);
  expect(issues({ headers: { "X-Id": "{{args.id}}" } })[0]).toMatch(/not allowed/);
  expect(issues({ headers: { "X-Id": "{{inputs.nope}}" } })[0]).toMatch(/not a declared input/);
  expect(issues({ baseUrl: "https://api.crm.example?x=1" })[0]).toMatch(/query string/);
});

test("endpoint schema: http only, no own inputs, url is a path", () => {
  const { id: _id, updatedAt: _u, updatedBy: _b, ...input } = endpoint();
  expect(toolInputSchema.safeParse(input).success).toBe(true);
  const messages = (over) => toolInputSchema.safeParse({ ...input, ...over }).error?.issues.map((i) => i.message) ?? [];
  expect(messages({ http: { ...input.http, url: "https://x.example/users" } })).toContain(
    "Start the path with /, e.g. /users/{{args.id}}.",
  );
  expect(messages({ inputs: [secret("k")] })).toContain("Endpoints use the connection's inputs.");
});

test("a bound endpoint runs with the connection's secret; omitted optional query and body are not sent", async () => {
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));
  const tool = bindConnection(endpoint({ method: "POST", body: "{{args.body}}" }), connection);
  const report = await runCustomTool(tool, { id: "a b" }, { apiKey: "sk-1" }, new AbortController().signal);
  expect(report.ok).toBe(true);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("https://api.crm.example/v1/users/a%20b");
  expect(init.headers.Authorization).toBe("Bearer sk-1");
  expect(init.body).toBeUndefined();

  await runCustomTool(
    tool,
    { id: "1", expand: "orgs", body: { a: 1 } },
    { apiKey: "sk-1" },
    new AbortController().signal,
  );
  const [url2, init2] = fetchMock.mock.calls[1];
  expect(String(url2)).toBe("https://api.crm.example/v1/users/1?expand=orgs");
  expect(JSON.parse(init2.body)).toEqual({ a: 1 });
});

test("connection secrets are bound to agent and connection, separate from tool secrets", () => {
  const owner = { id: "c1", name: "CRM", inputs: connection.inputs };
  const encoded = encodeAttachmentInputs("agent-1", owner, { apiKey: "sk-1" }, {}, "conn");
  expect(decodeAttachmentInputs("agent-1", owner, encoded.value, "conn")).toEqual({
    ok: true,
    value: { apiKey: "sk-1" },
  });
  expect(decodeAttachmentInputs("agent-1", owner, encoded.value, "tool").ok).toBe(false);
  expect(decodeAttachmentInputs("agent-2", owner, encoded.value, "conn").ok).toBe(false);
});

const spec = {
  openapi: "3.0.3",
  info: { title: "Pet Store API", description: "Pets." },
  servers: [{ url: "https://{env}.pets.example/v2/", variables: { env: { default: "api" } } }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      oauth: { type: "oauth2", flows: {} },
    },
    schemas: {
      Pet: {
        type: "object",
        required: ["name", "id"],
        properties: {
          id: { type: "integer", readOnly: true },
          name: { type: "string", nullable: true, example: "Rex", pattern: "(?<bad" },
          parent: { $ref: "#/components/schemas/Pet" },
          tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
        },
        discriminator: { propertyName: "kind" },
      },
      Tag: { type: "object", properties: { label: { type: "string" } }, xml: { name: "tag" } },
    },
    parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } } },
  },
  paths: {
    "/pets": {
      get: { operationId: "listPets", summary: "List pets", parameters: [{ $ref: "#/components/parameters/Limit" }] },
      post: {
        operationId: "createPet",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        },
      },
    },
    "/pets/{petId}": {
      parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
      get: { operationId: "getPet", parameters: [{ name: "X-Trace", in: "header", schema: { type: "string" } }] },
      delete: { operationId: "listPets" },
    },
    "/upload": { post: { requestBody: { content: { "multipart/form-data": { schema: {} } } } } },
  },
};

test("OpenAPI import: connection from info, server variables and bearer auth; unsupported auth warns", () => {
  const result = previewOpenApi(JSON.stringify(spec));
  expect(result.ok).toBe(true);
  const { connection: draft, warnings } = result.preview;
  expect(draft).toMatchObject({ key: "pet_store_api", name: "Pet Store API", baseUrl: "https://api.pets.example/v2" });
  expect(draft.inputs).toEqual([expect.objectContaining({ id: "bearerAuth", type: "secret", required: true })]);
  expect(draft.headers).toEqual({ Authorization: "Bearer {{inputs.bearerAuth}}" });
  expect(warnings.join(" ")).toMatch(/oauth/);
});

test("OpenAPI import: one tool per operation with path/query/body args, deduped keys and approval for writes", () => {
  const { endpoints } = previewOpenApi(JSON.stringify(spec)).preview;
  const byLabel = Object.fromEntries(endpoints.map((e) => [e.label, e]));
  const list = byLabel["GET /pets"].tool;
  expect(list).toMatchObject({ key: "pet_store_api_list_pets", name: "List pets", requiresApproval: false });
  expect(list.http).toMatchObject({ url: "/pets", query: { limit: "{{args.limit}}" } });
  expect(list.argsSchema.properties.limit).toEqual({ type: "integer", minimum: 1 });

  const create = byLabel["POST /pets"].tool;
  expect(create.requiresApproval).toBe(true);
  expect(create.http.body).toBe("{{args.body}}");
  expect(create.argsSchema.required).toEqual(["body"]);
  const pet = create.argsSchema.properties.body;
  expect(pet.properties.id).toBeUndefined();
  expect(pet.required).toEqual(["name"]);
  expect(pet.properties.name).toEqual({ type: ["string", "null"] });
  expect(pet.properties.tags.items).toEqual({ type: "object", properties: { label: { type: "string" } } });

  const get = byLabel["GET /pets/{petId}"];
  expect(get.tool.http.url).toBe("/pets/{{args.petId}}");
  expect(get.tool.argsSchema.required).toEqual(["petId"]);
  expect(get.notes.join(" ")).toMatch(/header parameter "X-Trace"/);
  expect(byLabel["DELETE /pets/{petId}"].tool.key).toBe("pet_store_api_list_pets_2");
  expect(byLabel["POST /upload"]).toMatchObject({ tool: null, error: expect.stringMatching(/JSON request bodies/) });
});

test("OpenAPI import: YAML, relative servers become a Base URL input, and Swagger 2 is refused", () => {
  const yaml = `openapi: 3.1.0
info: { title: "x" }
servers: [{ url: /api }]
components:
  securitySchemes:
    key: { type: apiKey, in: query, name: api_key }
paths:
  /items:
    get: { operationId: list }
`;
  const result = previewOpenApi(yaml);
  expect(result.ok).toBe(true);
  expect(result.preview.connection.key).toBe("api_x");
  expect(result.preview.connection.baseUrl).toBe("{{inputs.baseUrl}}/api");
  expect(result.preview.connection.inputs.map((f) => [f.id, f.type])).toEqual([
    ["baseUrl", "url"],
    ["key", "secret"],
  ]);
  expect(result.preview.endpoints[0].tool.http.query).toEqual({ api_key: "{{inputs.key}}" });
  expect(previewOpenApi('{"swagger":"2.0"}')).toEqual({ ok: false, error: expect.stringMatching(/Swagger 2.0/) });
  expect(previewOpenApi("{ nope").ok).toBe(false);
});

test("schema cleanup cuts reference cycles and keeps only supported keywords", () => {
  const doc = {
    components: { schemas: { A: { type: "object", properties: { a: { $ref: "#/components/schemas/A" } } } } },
  };
  const cleaned = cleanSchema(doc, { $ref: "#/components/schemas/A" });
  expect(cleaned.properties.a).toEqual({});
  expect(JSON.stringify(cleaned)).not.toContain("$ref");
  expect(snake("listPetsByID v2")).toBe("list_pets_by_id_v2");
});

test("shared secrets: encrypted per owner, blank keeps, empty clears, and they satisfy required agent values", () => {
  const fields = connection.inputs;
  const first = encodeSharedSecrets("conn", "c1", fields, { apiKey: "sk-shared" });
  expect(JSON.stringify(first.value)).not.toContain("sk-shared");
  const owner = { id: "c1", name: "CRM", inputs: fields };
  expect(decodeSharedSecrets("conn", owner, first.value)).toEqual({ ok: true, value: { apiKey: "sk-shared" } });
  expect(decodeSharedSecrets("tool", owner, first.value).ok).toBe(false);
  expect(decodeSharedSecrets("conn", { ...owner, id: "c2" }, first.value).ok).toBe(false);

  expect(encodeSharedSecrets("conn", "c1", fields, {}, first.value).value).toEqual(first.value);
  expect(encodeSharedSecrets("conn", "c1", fields, { apiKey: "" }, first.value).value).toEqual({});

  expect(encodeAttachmentInputs("agent-1", owner, {}, {}, "conn").ok).toBe(false);
  expect(encodeAttachmentInputs("agent-1", { ...owner, savedSecretValues: ["apiKey"] }, {}, {}, "conn").ok).toBe(true);
});

test("shared secrets may only name secret fields", () => {
  const parsed = toolConnectionInputSchema.safeParse({ ...connection, secretValues: { other: "x" } });
  expect(parsed.success).toBe(false);
  expect(toolConnectionInputSchema.safeParse({ ...connection, secretValues: { apiKey: "x" } }).success).toBe(true);
});
