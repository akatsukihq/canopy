import { toolSpec } from "./helpers/toolSpec.mjs";
import { test, expect, vi, afterEach, onTestFinished } from "vitest";
import redis from "redis";
import { Cache, closeRedis } from "../lib/cache/index.ts";
import { catalogCache } from "../lib/tool-framework/catalogCache.ts";
const jsonFormatterSpec = await toolSpec("json-formatter");

import { ADMIN_ACCESS } from "../lib/authorization/index.ts";
import {
  auditEventsTable,
  authSession,
  authUser,
  db,
  featureOverridesTable,
  invoiceTemplatesTable,
  managedToolsTable,
  rolesTable,
  userRolesTable,
} from "../db/index.ts";
import { createAdvancedTemplateConfig, seedTemplates } from "../lib/invoice-templates/index.ts";
import {
  archiveInvoiceTemplate,
  assignUserRoles,
  assignRoleToUsers,
  createAdvancedDocumentTemplate,
  createCustomRole,
  createInvoiceTemplate,
  deleteCustomRole,
  duplicateInvoiceTemplate,
  importInvoiceTemplate,
  publishInvoiceTemplate,
  redactAuditMetadata,
  reorderManagedTools,
  setDefaultInvoiceTemplate,
  setFeatureEnabled,
  setManagedToolArchived,
  setManagedToolEnabled,
  setUserStatus,
  updateAndPublishInvoiceTemplate,
  updateCustomRole,
  updateFeature,
  updateInvoiceTemplate,
  updateManagedTool,
  toolTranslationSource,
} from "../lib/admin/adminMutations.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function permissionRows(access) {
  return [
    {
      status: "active",
      roleId: "test-role",
      roleName: "Test role",
      roleDescription: "Test permissions.",
      roleAccess: {
        ...Object.fromEntries(
          Object.entries(access).map(([resource, actions]) => [
            resource,
            resource === "admin" ? actions : { view: true, ...actions },
          ]),
        ),
        admin: { enter: true, ...access.admin },
      },
      roleIsSystem: false,
    },
  ];
}

/**
 * The stored roster for one app. Reordering enumerates `managed_tools`, never a
 * bundled list, so the rows the transaction reads are what defines "complete".
 */
function toolRoster(toolIds, app) {
  return toolIds.map((toolId, order) => ({
    toolId,
    app,
    slug: toolId.split(".")[1],
    name: toolId,
    description: `Stored ${toolId}.`,
    order,
    enabled: true,
    archived: false,
  }));
}

function createFakeTransaction(selectResults) {
  const state = { inserts: [], updates: [], deletes: [] };

  function select() {
    const result = selectResults.shift();
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve, reject) =>
        result === undefined
          ? Promise.reject(new Error("Unexpected database read")).then(resolve, reject)
          : Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  function mutation(kind, table, values) {
    const entry = { table, values };
    state[kind].push(entry);
    const rows = Array.isArray(values) ? values : [values];
    const chain = {
      values(nextValues) {
        entry.values = nextValues;
        return mutationChain(kind, entry, nextValues);
      },
      set(nextValues) {
        entry.values = nextValues;
        return mutationChain(kind, entry, nextValues);
      },
      where: () => chain,
      returning: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return chain;
  }

  function mutationChain(kind, entry, values) {
    const rows = Array.isArray(values) ? values : [values];
    const chain = {
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: () => chain,
      where: () => chain,
      returning: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
    };
    return chain;
  }

  return {
    state,
    transaction: {
      select,
      insert: (table) => mutation("inserts", table),
      update: (table) => mutation("updates", table),
      delete: (table) => mutation("deletes", table),
    },
  };
}

async function withFakeDatabase(selectResults, callback) {
  const originalTransaction = db.transaction;
  const fake = createFakeTransaction([...selectResults]);
  db.transaction = async (operation) => operation(fake.transaction);
  try {
    return await callback(fake.state);
  } finally {
    db.transaction = originalTransaction;
  }
}

test("user and role mutations invalidate affected users through commit and rollback", async (t) => {
  let events = [];
  vi.spyOn(Cache.prototype, "beginInvalidation").mockImplementation(async function (id, ttl) {
    expect(ttl).toBe(this.namespace === "user" ? 3600 : 86400);
    events.push(`begin:${this.namespace}:${id}`);
    return id;
  });
  vi.spyOn(Cache.prototype, "endInvalidation").mockImplementation(async function (id, token, ttl) {
    expect(token).toBe(id);
    expect(ttl).toBe(this.namespace === "user" ? 3600 : 86400);
    events.push(`end:${this.namespace}:${id}`);
  });
  const target = { id: "target", status: "active", name: "Target", email: "target@example.test" };
  const role = { id: "editor", name: "Editor", description: "Editor", access: {}, isSystem: false };
  const cases = [
    {
      reads: [permissionRows({ users: { suspend: true } }), [target], [{ roleId: "user" }]],
      run: () => setUserStatus("actor", "target", "suspended"),
      ids: ["target"],
    },
    {
      reads: [
        permissionRows({ users: { assignRoles: true } }),
        [target],
        [{ roleId: "user" }],
        [{ id: "user", access: {} }, role],
      ],
      run: () => assignUserRoles("actor", "target", ["editor"]),
      ids: ["target"],
    },
    {
      reads: [permissionRows({ roles: { edit: true } }), [role], [{ userId: "a" }, { userId: "b" }]],
      run: () => updateCustomRole("actor", "editor", { name: "Renamed" }),
      ids: ["a", "b"],
    },
  ];
  for (const example of cases) {
    for (const rollback of [false, true]) {
      events = [];
      await withFakeDatabase(example.reads, async () => {
        const transaction = db.transaction;
        db.transaction = async (operation) => {
          const result = await transaction(operation);
          events.push(rollback ? "rollback" : "commit");
          if (rollback) throw new Error("Transaction rolled back");
          return result;
        };
        if (rollback) await expect(example.run()).rejects.toThrow(/Transaction rolled back/);
        else await example.run();
      });
      expect(events).toEqual([
        ...example.ids.flatMap((id) => [`begin:user:${id}`, `begin:user-roles:${id}`]),
        rollback ? "rollback" : "commit",
        ...example.ids.flatMap((id) => [`end:user:${id}`, `end:user-roles:${id}`]),
      ]);
    }
  }
  vi.spyOn(Cache.prototype, "beginInvalidation").mockImplementation(async () => {
    throw new Error("Cache unavailable");
  });
  await withFakeDatabase(cases[0].reads, async (state) => {
    await expect(cases[0].run()).rejects.toThrow(/Cache unavailable/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("catalog and role caches invalidate only after successful commits", async (t) => {
  const variables = ["REDIS_URL"];
  const previous = variables.map((key) => process.env[key]);
  onTestFinished(async () => {
    await closeRedis();
    catalogCache.clear();
    variables.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });
  process.env.REDIS_URL = "redis://cache.example.test:6379";
  let committed = false;
  const invalidated = [];
  vi.spyOn(redis, "createClient").mockImplementation(() => ({
    isOpen: false,
    isReady: false,
    on() {
      return this;
    },
    async connect() {
      this.isOpen = this.isReady = true;
      return this;
    },
    async sendCommand(command) {
      expect(committed, "Redis must not be called before commit").toBe(true);
      expect(command[0]).toBe("DEL");
      invalidated.push(command[1]);
      return 1;
    },
    destroy() {
      this.isOpen = this.isReady = false;
    },
  }));
  const tool = toolRoster(["devtools.stored-tool"], "devtools")[0];
  for (const [key, reads, operation] of [
    ["catalog:all", [permissionRows(ADMIN_ACCESS), [tool]], () => setManagedToolEnabled("actor", tool.toolId, false)],
    [
      "roles:all",
      [permissionRows(ADMIN_ACCESS)],
      () => createCustomRole("actor", { name: "Editor", description: "Edits tools." }),
    ],
  ]) {
    for (const rollback of [false, true]) {
      committed = false;
      const before = invalidated.length;
      const snapshot = { tools: [], paperworkTools: [], publicTools: [] };
      catalogCache.set("all", snapshot);
      await withFakeDatabase(reads, async () => {
        const transaction = db.transaction;
        db.transaction = async (callback) => {
          const result = await transaction(callback);
          expect(invalidated.length).toBe(before);
          expect(catalogCache.get("all"), "public cache remains live until commit succeeds").toBe(snapshot);
          if (rollback) throw new Error("Commit failed");
          committed = true;
          return result;
        };
        if (rollback) await expect(operation()).rejects.toThrow(/Commit failed/);
        else await operation();
      });
      expect(invalidated.slice(before)).toEqual(rollback || key === "catalog:all" ? [] : [key]);
      expect(catalogCache.get("all")).toBe(!rollback && key === "catalog:all" ? undefined : snapshot);
    }
  }
});

test("bulk role assignment adds only the requested role, preserves status and is idempotent", async () => {
  const role = {
    id: "reviewer",
    isSystem: false,
    access: { admin: { enter: true }, tools: { view: true } },
  };
  await withFakeDatabase(
    [
      permissionRows(ADMIN_ACCESS),
      permissionRows(ADMIN_ACCESS),
      [{ id: "a", status: "suspended" }],
      [{ id: "b", status: "active" }],
      [role],
      [{ roleId: "user" }, { roleId: "editor" }],
      [{ roleId: "user" }, { roleId: "reviewer" }],
    ],
    async (state) => {
      await assignRoleToUsers("actor", "reviewer", ["b", "a", "a"]);
      expect(state.inserts.filter((entry) => entry.table === userRolesTable).map((entry) => entry.values)).toEqual([
        { userId: "a", roleId: "reviewer" },
      ]);
      expect(state.deletes.length).toBe(0);
      expect(state.updates.length).toBe(0);
      expect(state.inserts.filter((entry) => entry.table === auditEventsTable).length).toBe(1);
    },
  );
});

test("bulk assignment rejects invalid selections, missing users and system roles", async () => {
  await expect(assignRoleToUsers("actor", "reviewer", [])).rejects.toThrow(/Select/);
  await expect(assignRoleToUsers("actor", "reviewer", Array(101).fill("a"))).rejects.toThrow(/100/);
  await withFakeDatabase([permissionRows(ADMIN_ACCESS), permissionRows(ADMIN_ACCESS), []], async (state) => {
    await expect(assignRoleToUsers("actor", "reviewer", ["missing"])).rejects.toThrow(/not found/i);
    expect(state.inserts.length).toBe(0);
  });
  await withFakeDatabase(
    [
      permissionRows(ADMIN_ACCESS),
      permissionRows(ADMIN_ACCESS),
      [{ id: "a", status: "active" }],
      [{ id: "admin", isSystem: true, access: ADMIN_ACCESS }],
    ],
    async (state) => {
      await expect(assignRoleToUsers("actor", "admin", ["a"])).rejects.toThrow(/custom role/i);
      expect(state.inserts.length).toBe(0);
    },
  );
});

test("bulk role assignment requires role viewing and user assignment permissions", async () => {
  for (const reads of [[permissionRows({})], [permissionRows(ADMIN_ACCESS), permissionRows({})]]) {
    await withFakeDatabase(reads, async (state) => {
      await expect(assignRoleToUsers("actor", "reviewer", ["a"])).rejects.toThrow();
      expect(state.inserts.length).toBe(0);
    });
  }
});

function accessWithout(resource, action) {
  const access = structuredClone(ADMIN_ACCESS);
  delete access[resource][action];
  return access;
}

function templateContent(overrides = {}) {
  const template = seedTemplates[0];
  return {
    name: template.name,
    slug: `test-${template.slug}`,
    description: template.description,
    category: template.category,
    layoutFamily: template.layoutFamily,
    config: structuredClone(template.config),
    ...overrides,
  };
}

function templateRow(overrides = {}) {
  const template = seedTemplates[0];
  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    description: template.description,
    category: template.category,
    status: template.status,
    isDefault: template.isDefault,
    version: template.version,
    documentType: template.documentType,
    layoutFamily: template.layoutFamily,
    config: structuredClone(template.config),
    isPremium: false,
    requiredPlan: "free",
    createdAt: new Date(template.createdAt),
    updatedAt: new Date(template.updatedAt),
    ...overrides,
  };
}

function advancedTemplateInput(overrides = {}) {
  return {
    name: "Advanced invoice",
    slug: "advanced-invoice",
    description: "A freely editable PDF template.",
    category: "professional",
    documentType: "invoice",
    pageFormat: "A4",
    ...overrides,
  };
}

function advancedTemplateRow(overrides = {}) {
  return {
    ...templateRow(),
    id: "advanced-template",
    name: "Advanced invoice",
    slug: "advanced-invoice",
    description: "A freely editable PDF template.",
    status: "draft",
    isDefault: false,
    documentType: "invoice",
    layoutFamily: "advanced",
    config: createAdvancedTemplateConfig("invoice", "A4"),
    ...overrides,
  };
}

test("every privileged mutation checks its exact PostgreSQL permission", async () => {
  const featureManifest = [
    {
      app: "paperwork",
      key: "new-editor",
      defaultName: "New editor",
      defaultDescription: "Controls the new editor.",
    },
  ];
  const cases = [
    ["tools.edit", () => updateManagedTool("actor", "paperwork.invoice-generator", {})],
    ["tools.edit", () => reorderManagedTools("actor", "paperwork", [])],
    ["tools.toggle", () => setManagedToolEnabled("actor", "paperwork.invoice-generator", true)],
    ["tools.archive", () => setManagedToolArchived("actor", "paperwork.invoice-generator", true)],
    ["features.edit", () => updateFeature("actor", "paperwork", "new-editor", {}, featureManifest)],
    ["features.toggle", () => setFeatureEnabled("actor", "paperwork", "new-editor", true, featureManifest)],
    ["users.assignRoles", () => assignUserRoles("actor", "target", ["user"])],
    ["users.suspend", () => setUserStatus("actor", "target", "suspended")],
    ["roles.create", () => createCustomRole("actor", { name: "Editor", description: "Edits templates." })],
    ["roles.edit", () => updateCustomRole("actor", "role", {})],
    ["roles.delete", () => deleteCustomRole("actor", "role")],
    ["templates.create", () => createInvoiceTemplate("actor", {})],
    ["templates.create", () => createAdvancedDocumentTemplate("actor", {})],
    ["templates.create", () => duplicateInvoiceTemplate("actor", "template", { name: "Copy", slug: "copy" })],
    ["templates.create", () => importInvoiceTemplate("actor", {})],
    ["templates.edit", () => updateInvoiceTemplate("actor", "template", {})],
    ["templates.publish", () => publishInvoiceTemplate("actor", "template")],
    ["templates.archive", () => archiveInvoiceTemplate("actor", "template")],
    ["templates.publish", () => setDefaultInvoiceTemplate("actor", "template")],
  ];

  for (const [permission, invoke] of cases) {
    const [resource, action] = permission.split(".");
    await withFakeDatabase([permissionRows(accessWithout(resource, action))], async (state) => {
      await expect(invoke()).rejects.toThrow(new RegExp(`Missing permission: ${permission.replace(".", "\\.")}`));
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

test("audit metadata recursively redacts authentication material", () => {
  expect(
    redactAuditMetadata({
      changed: ["name", "accessToken"],
      password: "hunter2",
      nested: {
        refreshToken: "token-value",
        cookie_header: "session=secret",
        oauthProvider: "google",
        safe: true,
      },
    }),
  ).toEqual({
    changed: ["name", "accessToken"],
    password: "[REDACTED]",
    nested: {
      refreshToken: "[REDACTED]",
      cookie_header: "[REDACTED]",
      oauthProvider: "google",
      safe: true,
    },
  });
});

test("tool setup validates and stores a code-owned slug with its audit event", async () => {
  // A setup-required row: seeded (or created by an admin) with no route yet.
  const setupRequired = {
    toolId: "devtools.json-formatter",
    app: "devtools",
    slug: null,
    name: "JSON Formatter",
    description: "Format JSON.",
    order: 0,
    enabled: false,
    archived: false,
  };

  await withFakeDatabase([permissionRows({ tools: { edit: true } }), [setupRequired], []], async (state) => {
    await updateManagedTool("actor", "devtools.json-formatter", {
      slug: "json-formatter",
      name: "JSON Formatter",
      description: "Format and validate JSON.",
    });

    const toolWrite = state.inserts.find(({ table }) => table === managedToolsTable);
    const auditWrite = state.inserts.find(({ table }) => table === auditEventsTable);
    expect(toolWrite.values.app).toBe("devtools");
    expect(toolWrite.values.slug).toBe("json-formatter");
    expect(auditWrite.values.action).toBe("tool.edit");
    expect(auditWrite.values.actorUserId).toBe("actor");
  });
});

test("tool reordering stores one contiguous app order and one audit event", async () => {
  const toolIds = [
    "paperwork.receipt-generator",
    "paperwork.invoice-generator",
    "paperwork.expense-report",
    "paperwork.mileage-log",
    "paperwork.quarterly-tax-estimator",
    "paperwork.w9-request",
    "paperwork.1099-nec-tracker",
  ];

  await withFakeDatabase(
    [permissionRows({ tools: { edit: true } }), toolRoster(toolIds, "paperwork")],
    async (state) => {
      await reorderManagedTools("actor", "paperwork", toolIds);

      expect(
        toolIds.map(
          (toolId) =>
            state.inserts.find(({ table, values }) => table === managedToolsTable && values.toolId === toolId).values
              .order,
        ),
      ).toEqual(toolIds.map((_, order) => order));
      const auditWrite = state.inserts.find(({ table }) => table === auditEventsTable);
      expect(auditWrite.values.action).toBe("tool.reorder");
      expect(auditWrite.values.targetId).toBe("paperwork");
    },
  );
});

test("tool reordering accepts a complete app roster in reverse", async () => {
  const roster = toolRoster(
    Array.from({ length: 30 }, (_, index) => `media.stored-tool-${index}`),
    "media",
  );
  const toolIds = roster.map((tool) => tool.toolId).reverse();

  await withFakeDatabase([permissionRows({ tools: { edit: true } }), roster], async (state) => {
    await reorderManagedTools("actor", "media", toolIds);

    expect(toolIds.length > 0, "the roster must not be empty").toBeTruthy();
    expect(
      toolIds.map(
        (toolId) =>
          state.inserts.find(({ table, values }) => table === managedToolsTable && values.toolId === toolId).values
            .order,
      ),
    ).toEqual(toolIds.map((_, order) => order));
  });
});

test("tool reordering rejects incomplete, duplicate, and cross-app orders", async () => {
  const invalidOrders = [
    [],
    [
      "paperwork.invoice-generator",
      "paperwork.invoice-generator",
      "paperwork.expense-report",
      "paperwork.mileage-log",
      "paperwork.quarterly-tax-estimator",
      "paperwork.w9-request",
      "paperwork.1099-nec-tracker",
    ],
    [
      "paperwork.invoice-generator",
      "paperwork.receipt-generator",
      "paperwork.expense-report",
      "paperwork.mileage-log",
      "paperwork.quarterly-tax-estimator",
      "paperwork.w9-request",
      "devtools.json-formatter",
    ],
  ];

  const paperworkRoster = toolRoster(
    [
      "paperwork.invoice-generator",
      "paperwork.receipt-generator",
      "paperwork.expense-report",
      "paperwork.mileage-log",
      "paperwork.quarterly-tax-estimator",
      "paperwork.w9-request",
      "paperwork.1099-nec-tracker",
    ],
    "paperwork",
  );

  for (const toolIds of invalidOrders) {
    await withFakeDatabase([permissionRows({ tools: { edit: true } }), paperworkRoster], async (state) => {
      await expect(reorderManagedTools("actor", "paperwork", toolIds)).rejects.toThrow(
        /every registered paperwork tool exactly once/,
      );
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

test("a saved tool slug is immutable and failed changes are not audited", async () => {
  const stored = {
    toolId: "devtools.json-formatter",
    app: "devtools",
    slug: "json-formatter",
    name: "JSON Formatter",
    description: "Format JSON.",
    order: 0,
    enabled: true,
    archived: false,
  };

  await withFakeDatabase([permissionRows({ tools: { edit: true } }), [stored]], async (state) => {
    await expect(
      updateManagedTool("actor", stored.toolId, {
        slug: "json-prettifier",
      }),
    ).rejects.toThrow(/slug is immutable/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("stored tools toggle, and archiving disables them", async () => {
  const stored = {
    toolId: "devtools.json-formatter",
    app: "devtools",
    slug: "json-formatter",
    name: "JSON Formatter",
    description: "Format JSON.",
    order: 0,
    enabled: true,
    archived: false,
    spec: jsonFormatterSpec,
  };
  stored.translations = {
    en: { status: "published", messages: toolTranslationSource(jsonFormatterSpec, stored, null) },
  };
  await withFakeDatabase(
    [permissionRows({ tools: { toggle: true } }), [{ ...stored, enabled: false }], []],
    async (state) => {
      await setManagedToolEnabled("actor", stored.toolId, true);
      const write = state.inserts.find(({ table }) => table === managedToolsTable);
      expect(write.values.slug).toBe(stored.slug);
      expect(write.values.enabled).toBe(true);
    },
  );

  await withFakeDatabase([permissionRows({ tools: { archive: true } }), [stored]], async (state) => {
    await setManagedToolArchived("actor", stored.toolId, true);
    const write = state.inserts.find(({ table }) => table === managedToolsTable);
    expect(write.values.archived).toBe(true);
    expect(write.values.enabled).toBe(false);
    expect(state.inserts.find(({ table }) => table === auditEventsTable).values.action).toBe("tool.archive");
  });

  await withFakeDatabase(
    [permissionRows({ tools: { toggle: true } }), [{ ...stored, archived: true }]],
    async (state) => {
      await expect(setManagedToolEnabled("actor", stored.toolId, true)).rejects.toThrow(
        /archived tool cannot be enabled/,
      );
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );

  await withFakeDatabase([permissionRows({ tools: { toggle: true } }), [stored]], async (state) => {
    await setManagedToolEnabled("actor", stored.toolId, false);
    expect(state.inserts.find(({ table }) => table === managedToolsTable).values.enabled).toBe(false);
  });
});

test("tool edits reject unknown tools, invalid slugs, and blank text", async () => {
  // With the row as the only registry, a tool id nobody stored simply does not
  // exist — there is no bundled entry left for it to fall back to.
  const storedRows = [
    {
      toolId: "devtools.json-formatter",
      app: "devtools",
      slug: "json-formatter",
      name: "JSON Formatter",
      description: "Format JSON.",
      order: 0,
      enabled: true,
      archived: false,
    },
  ];
  const cases = [
    [[], { name: "Valid" }, /Unknown tool/],
    [storedRows, { slug: "Admin" }, /slug is invalid or reserved/],
    [storedRows, { name: " " }, /Tool name is required/],
  ];
  for (const [storedRows, input, error] of cases) {
    await withFakeDatabase([permissionRows({ tools: { edit: true } }), storedRows], async (state) => {
      await expect(updateManagedTool("actor", "devtools.json-formatter", input)).rejects.toThrow(error);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

test("unregistered feature keys cannot create overrides", async () => {
  await withFakeDatabase([permissionRows({ features: { edit: true } })], async (state) => {
    await expect(updateFeature("actor", "paperwork", "unknown", {}, [])).rejects.toThrow(/Unknown feature/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("registered features default disabled and preserve metadata when toggled", async () => {
  const manifest = [
    {
      app: "paperwork",
      key: "new-editor",
      defaultName: "New editor",
      defaultDescription: "Controls the new editor.",
    },
  ];
  await withFakeDatabase([permissionRows({ features: { edit: true } }), []], async (state) => {
    await updateFeature("actor", "paperwork", "new-editor", { name: "Invoice editor" }, manifest);
    const write = state.inserts.find(({ table }) => table === featureOverridesTable);
    expect(write.values.name).toBe("Invoice editor");
    expect(write.values.description).toBe("Controls the new editor.");
    expect(write.values.enabled).toBe(false);
  });

  await withFakeDatabase(
    [
      permissionRows({ features: { toggle: true } }),
      [
        {
          app: "paperwork",
          key: "new-editor",
          name: "Invoice editor",
          description: "Controls the new editor.",
          enabled: false,
        },
      ],
    ],
    async (state) => {
      await setFeatureEnabled("actor", "paperwork", "new-editor", true, manifest);
      const write = state.inserts.find(({ table }) => table === featureOverridesTable);
      expect(write.values.name).toBe("Invoice editor");
      expect(write.values.enabled).toBe(true);
    },
  );
});

test("suspension protects the final admin and retains identity while auditing the status change", async () => {
  const target = {
    id: "target",
    name: "Target",
    email: "target@example.com",
    image: null,
    status: "active",
  };

  await withFakeDatabase(
    [
      permissionRows({ users: { suspend: true } }),
      [target],
      [{ roleId: "admin" }],
      [{ userId: "target", status: "active" }],
    ],
    async (state) => {
      await expect(setUserStatus("actor", "target", "suspended")).rejects.toThrow(/final Admin/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );

  await withFakeDatabase(
    [permissionRows({ users: { suspend: true } }), [target], [{ roleId: "user" }]],
    async (state) => {
      await setUserStatus("actor", "target", "suspended");
      expect(state.updates.find(({ table }) => table === authUser).values.status).toBe("suspended");
      expect(state.deletes.some(({ table }) => table === authSession)).toBe(false);
      expect(state.inserts.find(({ table }) => table === auditEventsTable).values.action).toBe("user.suspend");
    },
  );
});

test("role assignment keeps the default user role and protects the final admin", async () => {
  const target = {
    id: "target",
    name: "Target",
    email: "target@example.com",
    image: null,
    status: "active",
  };
  await withFakeDatabase(
    [
      permissionRows({ users: { assignRoles: true } }),
      [target],
      [{ roleId: "user" }],
      [
        { id: "user", access: {} },
        { id: "editor", access: { admin: { enter: true }, templates: { view: true, edit: true } } },
      ],
    ],
    async (state) => {
      expect(await assignUserRoles("actor", "target", ["editor", "editor"])).toEqual(["user", "editor"]);
      expect(state.inserts.find(({ table }) => table === userRolesTable).values).toEqual([
        { userId: "target", roleId: "editor" },
      ]);
      expect(state.deletes.some(({ table }) => table === userRolesTable)).toBe(false);
    },
  );

  await withFakeDatabase(
    [
      permissionRows({ users: { assignRoles: true } }),
      [target],
      [{ roleId: "user" }, { roleId: "admin" }],
      [{ id: "user", access: {} }],
      [{ userId: "target", status: "active" }],
    ],
    async (state) => {
      await expect(assignUserRoles("actor", "target", ["user"])).rejects.toThrow(/final Admin/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );

  await withFakeDatabase(
    [permissionRows({ users: { assignRoles: true } }), [target], [{ roleId: "user" }], [{ id: "user", access: {} }]],
    async (state) => {
      expect(await assignUserRoles("actor", "target", ["user"])).toEqual(["user"]);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );

  await withFakeDatabase(
    [permissionRows({ users: { assignRoles: true } }), [target], [{ roleId: "user" }], [{ id: "user", access: {} }]],
    async (state) => {
      await expect(assignUserRoles("actor", "target", ["missing"])).rejects.toThrow(/roles do not exist/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );

  await withFakeDatabase(
    [
      permissionRows({ users: { assignRoles: true } }),
      [target],
      [{ roleId: "user" }, { roleId: "editor" }],
      [{ id: "user", access: {} }],
    ],
    async (state) => {
      await assignUserRoles("actor", "target", ["user"]);
      expect(state.deletes.some(({ table }) => table === userRolesTable)).toBeTruthy();
      expect(state.inserts.some(({ table }) => table === userRolesTable)).toBe(false);
    },
  );
});

test("inactive actors and invalid user statuses fail before mutation", async () => {
  await withFakeDatabase([[]], async (state) => {
    await expect(createCustomRole("actor", { name: "Role", description: "Role." })).rejects.toThrow(/Access denied/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  await withFakeDatabase([permissionRows({ users: { suspend: true } })], async (state) => {
    await expect(setUserStatus("actor", "target", "deleted")).rejects.toThrow(/must be active or suspended/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("role assignment validates prerequisites across the combined selected roles before writing", async () => {
  const target = {
    id: "target",
    name: "Target",
    email: "target@example.com",
    image: null,
    status: "active",
  };
  const entry = { id: "entry", access: { admin: { enter: true } } };
  const viewer = { id: "viewer", access: { tools: { view: true } } };
  const editor = { id: "editor", access: { tools: { edit: true } } };
  for (const [selected, error] of [
    [[editor], /requires admin.enter/],
    [[entry, editor], /requires tools.view/],
    [[entry, viewer, editor], null],
    [[], null],
  ]) {
    const requested = selected.map(({ id }) => id);
    await withFakeDatabase(
      [
        permissionRows({ users: { assignRoles: true } }),
        [target],
        [{ roleId: "user" }],
        [{ id: "user", access: {} }, ...selected],
      ],
      async (state) => {
        if (error) {
          await expect(assignUserRoles("actor", target.id, requested)).rejects.toThrow(error);
          expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
        } else {
          expect(await assignUserRoles("actor", target.id, requested)).toEqual(["user", ...requested]);
          if (requested.length) {
            expect(state.inserts.find(({ table }) => table === userRolesTable).values).toEqual(
              requested.map((roleId) => ({ userId: target.id, roleId })),
            );
            expect(state.inserts.some(({ table }) => table === auditEventsTable)).toBeTruthy();
          } else {
            expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
          }
        }
      },
    );
  }
});

test("role saves and direct mutations reject missing prerequisites before writing", async () => {
  const role = {
    id: "editor",
    name: "Editor",
    description: "Edits tools.",
    access: {},
    isSystem: false,
  };
  for (const access of [{ tools: { edit: true } }, { admin: { enter: true }, tools: { edit: true } }]) {
    await withFakeDatabase([permissionRows({ roles: { edit: true } }), [role]], async (state) => {
      await expect(updateCustomRole("actor", role.id, { access })).rejects.toThrow(/requires/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
  for (const access of [
    { admin: { enter: false }, roles: { view: true, edit: true } },
    { roles: { view: false, edit: true } },
  ]) {
    await withFakeDatabase([permissionRows(access)], async (state) => {
      await expect(updateCustomRole("actor", role.id, { name: "New name" })).rejects.toThrow(/Missing permission/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

test("custom roles start with admin entry only and assigned roles cannot be deleted", async () => {
  await withFakeDatabase([permissionRows({ roles: { create: true } })], async (state) => {
    await createCustomRole("actor", {
      name: "Template editor",
      description: "Edits invoice templates.",
    });
    const roleWrite = state.inserts.find(({ table }) => table === rolesTable);
    expect(roleWrite.values.access).toEqual({ admin: { enter: true } });
    expect(roleWrite.values.isSystem).toBe(false);
    expect(state.inserts.some(({ table }) => table === auditEventsTable)).toBeTruthy();
  });

  await withFakeDatabase(
    [
      permissionRows({ roles: { delete: true } }),
      [
        {
          id: "editor",
          name: "Editor",
          description: "Edits templates.",
          access: {},
          isSystem: false,
        },
      ],
      [{ userId: "target" }],
    ],
    async (state) => {
      await expect(deleteCustomRole("actor", "editor")).rejects.toThrow(/assigned to users/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );
});

test("custom role saves retain admin entry while accepting only valid entity grants", async () => {
  const role = {
    id: "editor",
    name: "Editor",
    description: "Edits tools.",
    access: { tools: { view: true, edit: true } },
    isSystem: false,
  };
  for (const input of [
    { access: {} },
    { access: { admin: { enter: false } } },
    { name: "Renamed" },
    { access: { tools: { view: true } } },
  ]) {
    await withFakeDatabase([permissionRows({ roles: { edit: true } }), [role], []], async (state) => {
      const saved = await updateCustomRole("actor", role.id, input);
      expect(saved.access).toEqual({
        ...(input.access ?? role.access),
        admin: { enter: true },
      });
      expect(state.updates.find(({ table }) => table === rolesTable).values.access).toEqual(saved.access);
      expect(
        state.inserts.find(({ table }) => table === auditEventsTable).values.metadata.changes.includes("access"),
      ).toBeTruthy();
    });
  }
  for (const access of [null, [], { admin: null }, { admin: { enter: "yes" } }, { admin: { unknown: true } }]) {
    await withFakeDatabase([permissionRows({ roles: { edit: true } }), [role]], async (state) => {
      await expect(updateCustomRole("actor", role.id, { access })).rejects.toThrow(/object|boolean|Unknown permission/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
  for (const protectedRole of [
    { ...role, id: "admin", access: ADMIN_ACCESS },
    { ...role, id: "user" },
    { ...role, isSystem: true },
  ]) {
    await withFakeDatabase([permissionRows({ roles: { edit: true } }), [protectedRole]], async (state) => {
      await expect(updateCustomRole("actor", protectedRole.id, { access: {} })).rejects.toThrow(
        /System roles are protected/,
      );
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

test("custom role edits validate access and unassigned custom roles can be deleted", async () => {
  const role = {
    id: "editor",
    name: "Editor",
    description: "Edits templates.",
    access: {},
    isSystem: false,
  };
  await withFakeDatabase([permissionRows({ roles: { edit: true } }), [role], []], async (state) => {
    await updateCustomRole("actor", role.id, {
      description: "Edits and publishes templates.",
      access: { admin: { enter: true }, templates: { view: true, edit: true, publish: true } },
    });
    const write = state.updates.find(({ table }) => table === rolesTable);
    expect(write.values.access).toEqual({
      admin: { enter: true },
      templates: { view: true, edit: true, publish: true },
    });
    expect(state.inserts.some(({ table }) => table === auditEventsTable)).toBeTruthy();
  });

  await withFakeDatabase([permissionRows({ roles: { delete: true } }), [role], []], async (state) => {
    await deleteCustomRole("actor", role.id);
    expect(state.deletes.some(({ table }) => table === rolesTable)).toBeTruthy();
    expect(state.inserts.some(({ table }) => table === auditEventsTable)).toBeTruthy();
  });
});

test("template creation uses shared validation and starts as a non-default draft", async () => {
  await withFakeDatabase([permissionRows({ templates: { create: true } }), []], async (state) => {
    await createInvoiceTemplate("actor", templateContent());
    const templateWrite = state.inserts.find(({ table }) => table === invoiceTemplatesTable);
    expect(templateWrite.values.status).toBe("draft");
    expect(templateWrite.values.isDefault).toBe(false);
    expect(state.inserts.some(({ table }) => table === auditEventsTable)).toBeTruthy();
  });

  await withFakeDatabase([permissionRows({ templates: { create: true } })], async (state) => {
    await expect(createInvoiceTemplate("actor", templateContent({ name: "x" }))).rejects.toThrow(
      /Template name must be at least 2 characters/,
    );
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("advanced template creation validates invoice and receipt drafts", async () => {
  for (const input of [
    advancedTemplateInput(),
    advancedTemplateInput({
      name: "Advanced receipt",
      slug: "advanced-receipt",
      documentType: "receipt",
      pageFormat: "RECEIPT_80MM",
    }),
  ]) {
    await withFakeDatabase([permissionRows({ templates: { create: true } }), []], async (state) => {
      await createAdvancedDocumentTemplate("actor", input);
      const templateWrite = state.inserts.find(({ table }) => table === invoiceTemplatesTable);
      expect(templateWrite.values.status).toBe("draft");
      expect(templateWrite.values.isDefault).toBe(false);
      expect(templateWrite.values.documentType).toBe(input.documentType);
      expect(templateWrite.values.layoutFamily).toBe("advanced");
      expect(templateWrite.values.config.editor).toBe("pdfme");
      expect(templateWrite.values.config.pageFormat).toBe(input.pageFormat);
    });
  }

  await withFakeDatabase([permissionRows({ templates: { create: true } })], async (state) => {
    await expect(
      createAdvancedDocumentTemplate("actor", advancedTemplateInput({ pageFormat: "RECEIPT_80MM" })),
    ).rejects.toThrow(/invoice|page format/i);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("template duplicate, import, and edit stay validated and audited", async () => {
  const source = templateRow();
  await withFakeDatabase([permissionRows({ templates: { create: true } }), [source], []], async (state) => {
    await duplicateInvoiceTemplate("actor", source.id, {
      name: "Classic copy",
      slug: "classic-copy",
    });
    const write = state.inserts.find(({ table }) => table === invoiceTemplatesTable);
    expect(write.values.name).toBe("Classic copy");
    expect(write.values.status).toBe("draft");
  });

  await withFakeDatabase([permissionRows({ templates: { create: true } }), []], async (state) => {
    await importInvoiceTemplate("actor", {
      ...seedTemplates[1],
      slug: "imported-modern",
    });
    expect(state.inserts.find(({ table }) => table === auditEventsTable).values.action).toBe("template.import");
  });

  await withFakeDatabase([permissionRows({ templates: { edit: true } }), [source], []], async (state) => {
    await updateInvoiceTemplate("actor", source.id, {
      name: "Classic updated",
    });
    const write = state.updates.find(({ table }) => table === invoiceTemplatesTable);
    expect(write.values.name).toBe("Classic updated");
    expect(write.values.version).toBe(source.version + 1);
  });

  await withFakeDatabase([permissionRows({ templates: { edit: true } }), [source]], async (state) => {
    await expect(updateInvoiceTemplate("actor", source.id, { slug: "changed-slug" })).rejects.toThrow(
      /Template slug cannot be changed/,
    );
    expect(state.updates.length).toBe(0);
  });
});

test("advanced templates can be duplicated, imported, and edited", async () => {
  const source = advancedTemplateRow();

  await withFakeDatabase([permissionRows({ templates: { create: true } }), [source], []], async (state) => {
    await duplicateInvoiceTemplate("actor", source.id, {
      name: "Advanced copy",
      slug: "advanced-copy",
    });
    const write = state.inserts.find(({ table }) => table === invoiceTemplatesTable);
    expect(write.values.documentType).toBe("invoice");
    expect(write.values.layoutFamily).toBe("advanced");
    expect(write.values.config).toEqual(source.config);
  });

  await withFakeDatabase([permissionRows({ templates: { create: true } }), []], async (state) => {
    await importInvoiceTemplate("actor", source);
    const write = state.inserts.find(({ table }) => table === invoiceTemplatesTable);
    expect(write.values.layoutFamily).toBe("advanced");
    expect(write.values.status).toBe("draft");
    expect(write.values.isDefault).toBe(false);
  });

  const nextConfig = structuredClone(source.config);
  nextConfig.sampleData.documentNumber = "INV-UPDATED";
  await withFakeDatabase([permissionRows({ templates: { edit: true } }), [source], []], async (state) => {
    await updateInvoiceTemplate("actor", source.id, {
      name: "Advanced updated",
      config: nextConfig,
    });
    const write = state.updates.find(({ table }) => table === invoiceTemplatesTable);
    expect(write.values.name).toBe("Advanced updated");
    expect(write.values.layoutFamily).toBe("advanced");
    expect(write.values.config).toEqual(nextConfig);
  });
});

test("template publication maintains one default and protects it from archival", async () => {
  const draft = templateRow({ status: "draft", isDefault: false });
  await withFakeDatabase(
    [
      permissionRows({ templates: { publish: true } }),
      [draft],
      permissionRows({ templates: { publish: true } }),
      [draft],
      [],
    ],
    async (state) => {
      await publishInvoiceTemplate("actor", draft.id);
      const write = state.updates.find(({ table }) => table === invoiceTemplatesTable);
      expect(write.values.status).toBe("published");
      expect(write.values.isDefault).toBe(true);
    },
  );

  const published = templateRow({ id: "other", isDefault: false });
  await withFakeDatabase([permissionRows({ templates: { publish: true } }), [published], []], async (state) => {
    await setDefaultInvoiceTemplate("actor", published.id);
    const templateUpdates = state.updates.filter(({ table }) => table === invoiceTemplatesTable);
    expect(templateUpdates.length).toBe(2);
    expect(templateUpdates[0].values.isDefault).toBe(false);
    expect(templateUpdates[1].values.isDefault).toBe(true);
  });

  const currentDefault = templateRow({ isDefault: true });
  await withFakeDatabase([permissionRows({ templates: { archive: true } }), [currentDefault]], async (state) => {
    await expect(archiveInvoiceTemplate("actor", currentDefault.id)).rejects.toThrow(/Set another published default/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  await withFakeDatabase(
    [permissionRows({ templates: { archive: true } }), [templateRow({ id: "old", isDefault: false })]],
    async (state) => {
      await archiveInvoiceTemplate("actor", "old");
      expect(state.updates.find(({ table }) => table === invoiceTemplatesTable).values.status).toBe("archived");
    },
  );

  await withFakeDatabase(
    [
      permissionRows({ templates: { publish: true } }),
      [templateRow({ id: "draft", status: "draft", isDefault: false })],
    ],
    async (state) => {
      await expect(setDefaultInvoiceTemplate("actor", "draft")).rejects.toThrow(/Only a published template/);
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );
});

test("advanced templates publish and use defaults within their document kind", async () => {
  const draft = advancedTemplateRow();
  await withFakeDatabase(
    [
      permissionRows({ templates: { publish: true } }),
      [draft],
      permissionRows({ templates: { publish: true } }),
      [draft],
      [{ id: seedTemplates[0].id }],
    ],
    async (state) => {
      await publishInvoiceTemplate("actor", draft.id);
      const write = state.updates.find(({ table }) => table === invoiceTemplatesTable);
      expect(write.values.status).toBe("published");
      expect(write.values.isDefault).toBe(false);
    },
  );

  const published = advancedTemplateRow({ status: "published" });
  await withFakeDatabase(
    [permissionRows({ templates: { publish: true } }), [published], [{ id: seedTemplates[0].id }]],
    async (state) => {
      await setDefaultInvoiceTemplate("actor", published.id);
      const templateUpdates = state.updates.filter(({ table }) => table === invoiceTemplatesTable);
      expect(templateUpdates.length).toBe(2);
      expect(templateUpdates[0].values.isDefault).toBe(false);
      expect(templateUpdates[1].values.isDefault).toBe(true);
    },
  );
});

test("template update and publish use a version-gated publication transaction", async () => {
  const source = templateRow({ status: "draft", isDefault: false });
  const updated = templateRow({
    ...source,
    name: "Published update",
    version: source.version + 1,
  });

  await withFakeDatabase(
    [
      permissionRows({ templates: { edit: true, publish: true } }),
      [source],
      [],
      permissionRows({ templates: { edit: true, publish: true } }),
      [updated],
      [],
    ],
    async (state) => {
      await updateAndPublishInvoiceTemplate("actor", source.id, {
        name: updated.name,
      });
      const templateUpdates = state.updates.filter(({ table }) => table === invoiceTemplatesTable);
      expect(templateUpdates.length).toBe(2);
      expect(templateUpdates[0].values.name).toBe(updated.name);
      expect(templateUpdates[1].values.status).toBe("published");
    },
  );
});
