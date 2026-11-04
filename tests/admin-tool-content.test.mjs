import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

// vi.hoisted runs before the hoisted vi.mock factory so the fake Cloudinary
// upload can record its calls where the test can read them.
const uploadCalls = vi.hoisted(() => []);

vi.mock("@/lib/tool-framework/cloudinary.ts", () => ({
  uploadToolIcon: async (...args) => {
    uploadCalls.push(args);
    return {
      ok: true,
      icon: {
        v: 1,
        provider: "cloudinary",
        format: "png",
        width: 256,
        height: 256,
        uploadedAt: "2026-01-01T00:00:00Z",
        entry: { cloudName: "demo", publicId: "icons/stored-tool", version: 1 },
      },
    };
  },
}));

import { ADMIN_ACCESS } from "../lib/authorization/index.ts";
import { auditEventsTable, db, managedToolsTable, toolContentTable } from "../db/index.ts";
import {
  removeToolIcon,
  saveToolIcon,
  setToolContentPublished,
  updateToolContent,
} from "../lib/admin/adminMutations.ts";
import { TOOL_CONTENT_DOC_VERSION, resolveContent } from "../lib/tool-framework/content.ts";
import { TOOL_CATEGORIES } from "../lib/tool-framework/categories.ts";
import { renderIdenticon } from "../lib/tool-framework/identicon.ts";

// No tool is named here, and none needs to be: the roster these mutations
// validate against is the `managed_tools` rows the transaction reads, which the
// fake database below supplies.
const TOOL_ID = "devtools.stored-tool";
const RELATED_TOOL_ID = "devtools.other-stored-tool";
const CATEGORY = Object.keys(TOOL_CATEGORIES)[0];

/** The stored row behind `TOOL_ID`. */
const TOOL_ROW = [
  {
    toolId: TOOL_ID,
    app: "devtools",
    slug: "stored-tool",
    name: "Stored Tool",
    description: "A stored tool.",
    order: 0,
    enabled: true,
    archived: false,
  },
];

/** The roster `updateToolContent` validates `relatedToolIds` against. */
const TOOL_ROSTER = [{ toolId: TOOL_ID }, { toolId: RELATED_TOOL_ID }];

// -- the fake transaction, matching tests/control-plane-admin.test.mjs --------

function permissionRows(access) {
  return [
    {
      status: "active",
      roleId: "test-role",
      roleName: "Test role",
      roleDescription: "Test permissions.",
      roleAccess: { ...access, admin: { enter: true, ...access.admin } },
      roleIsSystem: false,
    },
  ];
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

  function mutationChain(kind, entry, values) {
    const rows = Array.isArray(values) ? values : [values];
    const chain = {
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: (config) => {
        entry.set = config?.set;
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
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

function accessWithout(resource, action) {
  const access = structuredClone(ADMIN_ACCESS);
  delete access[resource][action];
  return access;
}

function contentWrite(state) {
  return state.inserts.find(({ table }) => table === toolContentTable);
}

function auditWrite(state) {
  return state.inserts.find(({ table }) => table === auditEventsTable);
}

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
}

const EMPTY_EDIT = {
  category: null,
  keywords: null,
  seoTitle: null,
  seoDescription: null,
  contentDoc: null,
};

// -- authorization ----------------------------------------------------------

test("every tool content mutation checks its exact permission", async () => {
  const cases = [
    ["tools.edit", () => updateToolContent("actor", TOOL_ID, EMPTY_EDIT)],
    ["tools.toggle", () => setToolContentPublished("actor", TOOL_ID, true)],
    [
      "tools.edit",
      () =>
        saveToolIcon("actor", TOOL_ID, {
          bytes: pngBytes(),
          mimeType: "image/png",
        }),
    ],
    ["tools.edit", () => removeToolIcon("actor", TOOL_ID)],
  ];

  for (const [permission, invoke] of cases) {
    const [resource, action] = permission.split(".");
    await withFakeDatabase([permissionRows(accessWithout(resource, action))], async (state) => {
      await expect(invoke()).rejects.toThrow(new RegExp(`Missing permission: ${permission.replace(".", "\\.")}`));
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    });
  }
});

// -- content validation -----------------------------------------------------

test("a category outside the registry is rejected on write", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, TOOL_ROSTER],
    async (state) => {
      await expect(
        updateToolContent("actor", TOOL_ID, {
          ...EMPTY_EDIT,
          category: "totally-made-up",
        }),
      ).rejects.toThrow(/not a registered category/);
      expect(state.inserts).toEqual([]);
    },
  );
});

test("blank text and empty lists clear the override instead of storing empties", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, TOOL_ROSTER],
    async (state) => {
      await updateToolContent("actor", TOOL_ID, {
        category: "   ",
        keywords: ["", "   "],
        seoTitle: "",
        seoDescription: "   ",
        contentDoc: {
          howToUse: [],
          limitations: [],
          faq: [],
          examples: [],
          relatedToolIds: [],
        },
      });

      const write = contentWrite(state);
      expect(write.values.toolId).toBe(TOOL_ID);
      expect(write.values.category).toBe(null);
      expect(write.values.keywords).toBe(null);
      expect(write.values.seoTitle).toBe(null);
      expect(write.values.seoDescription).toBe(null);
      expect(write.values.contentDoc).toBe(null);
      // The conflict branch clears the same columns, so re-saving a row that
      // already had overrides really does drop them.
      expect(write.set.category).toBe(null);
      expect(write.set.contentDoc).toBe(null);
      expect(auditWrite(state).values.action).toBe("tool.content-edit");
    },
  );
});

test("a stored content document is written at the version the resolver reads", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, TOOL_ROSTER],
    async (state) => {
      await updateToolContent("actor", TOOL_ID, {
        ...EMPTY_EDIT,
        category: CATEGORY,
        keywords: ["one", " two "],
        seoTitle: " Stored title ",
        contentDoc: {
          howToUse: ["Paste the input", "Read the output"],
          faq: [{ q: "Is it stored?", a: "No." }],
          relatedToolIds: [RELATED_TOOL_ID],
        },
      });

      const { values } = contentWrite(state);
      expect(values.docVersion).toBe(TOOL_CONTENT_DOC_VERSION);
      expect(values.contentDoc.version).toBe(TOOL_CONTENT_DOC_VERSION);
      expect(values.keywords).toEqual(["one", "two"]);
      expect(values.seoTitle).toBe("Stored title");

      // The written row must survive the read path rather than silently
      // falling back to the shipped content.
      const spec = {
        toolId: TOOL_ID,
        app: "devtools",
        category: CATEGORY,
        keywords: ["shipped"],
        name: "Shipped name",
        description: "Shipped description.",
        content: { howToUse: ["Shipped step"] },
      };
      const resolved = resolveContent(spec, {
        ...values,
        publishedAt: new Date(),
      });
      expect(resolved.content.howToUse).toEqual(["Paste the input", "Read the output"]);
      expect(resolved.keywords).toEqual(["one", "two"]);
      expect(resolved.seoTitle).toBe("Stored title");
    },
  );
});

test("related tools must be tool ids, never slugs", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, TOOL_ROSTER],
    async (state) => {
      await expect(
        updateToolContent("actor", TOOL_ID, {
          ...EMPTY_EDIT,
          contentDoc: {
            howToUse: ["Paste the input"],
            relatedToolIds: [RELATED_TOOL_ID.split(".")[1]],
          },
        }),
      ).rejects.toThrow(/must be tool ids, not slugs/);
      expect(state.inserts).toEqual([]);
    },
  );
});

// -- draft and publish ------------------------------------------------------

test("publishing sets published_at and unpublishing clears it", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, toggle: true } }), TOOL_ROW, [{ toolId: TOOL_ID }]],
    async (state) => {
      await setToolContentPublished("actor", TOOL_ID, true);
      expect(state.updates[0].values.publishedAt instanceof Date).toBeTruthy();
      expect(auditWrite(state).values.action).toBe("tool.content-publish");
    },
  );

  await withFakeDatabase(
    [permissionRows({ tools: { view: true, toggle: true } }), TOOL_ROW, [{ toolId: TOOL_ID }]],
    async (state) => {
      await setToolContentPublished("actor", TOOL_ID, false);
      expect(state.updates[0].values.publishedAt).toBe(null);
    },
  );
});

test("content that was never saved cannot be published", async () => {
  await withFakeDatabase([permissionRows({ tools: { view: true, toggle: true } }), TOOL_ROW, []], async (state) => {
    await expect(setToolContentPublished("actor", TOOL_ID, true)).rejects.toThrow(
      /Save tool content before publishing/,
    );
    expect(state.updates).toEqual([]);
  });
});

test("an unpublished row leaves the code values live", () => {
  const spec = {
    toolId: TOOL_ID,
    app: "devtools",
    category: CATEGORY,
    keywords: ["shipped"],
    name: "Shipped name",
    description: "Shipped description.",
    content: { howToUse: ["Shipped step"] },
  };
  const draftRow = {
    toolId: TOOL_ID,
    category: CATEGORY,
    keywords: ["stored"],
    seoTitle: "Stored title",
    seoDescription: null,
    contentDoc: { version: TOOL_CONTENT_DOC_VERSION, howToUse: ["Stored step"] },
    docVersion: TOOL_CONTENT_DOC_VERSION,
    publishedAt: null,
    updatedAt: new Date(),
  };
  expect(resolveContent(spec, draftRow).keywords).toEqual(["shipped"]);
  expect(resolveContent(spec, { ...draftRow, publishedAt: new Date() }).keywords).toEqual(["stored"]);
});

// -- icons ------------------------------------------------------------------

test("an icon over 1 MB is rejected before any database or upload work", async () => {
  await withFakeDatabase([], async (state) => {
    await expect(
      saveToolIcon("actor", TOOL_ID, {
        bytes: new Uint8Array(1_048_577),
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/1 MB or smaller/);
    expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

test("SVG is rejected by MIME type and by its leading bytes", async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  await withFakeDatabase([], async () => {
    // Declared as SVG.
    await expect(
      saveToolIcon("actor", TOOL_ID, {
        bytes: pngBytes(),
        mimeType: "image/svg+xml",
      }),
    ).rejects.toThrow(/SVG icons are not supported/);
    // SVG markup wearing a PNG content type.
    await expect(saveToolIcon("actor", TOOL_ID, { bytes: svg, mimeType: "image/png" })).rejects.toThrow(
      /SVG icons are not supported/,
    );
  });
});

test("upload stores the media ref on its tool and records the existing audit event", async () => {
  const permissions = permissionRows({ tools: { view: true, edit: true } });
  await withFakeDatabase([permissions, TOOL_ROW, permissions, TOOL_ROW], async (state) => {
    const iconUrl = await saveToolIcon("actor", TOOL_ID, { bytes: pngBytes(), mimeType: "image/png" });
    expect(iconUrl).toBe("https://res.cloudinary.com/demo/image/upload/f_png,c_fill,w_256,h_256,q_auto/v1/icons/stored-tool.png");
    expect(state.updates[0].table).toBe(managedToolsTable);
    expect(state.updates[0].values.icon.entry.publicId).toBe("icons/stored-tool");
    expect(state.updates[0].values.updatedAt instanceof Date).toBeTruthy();
    expect(state.inserts.filter(({ table }) => table !== auditEventsTable).length).toBe(0);
    expect(auditWrite(state).values.action).toBe("tool.icon-upload");
    expect(uploadCalls.at(-1)[0]).toBe(TOOL_ID);
  });
});

test("revoked permission after upload leaves the stored icon unchanged", async () => {
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, permissionRows({ tools: { view: true } })],
    async (state) => {
      await expect(saveToolIcon("actor", TOOL_ID, { bytes: pngBytes(), mimeType: "image/png" })).rejects.toThrow(
        /Missing permission/,
      );
      expect(state).toEqual({ inserts: [], updates: [], deletes: [] });
    },
  );
});

test("removing an icon clears it and falls back to the identicon", async () => {
  await withFakeDatabase([permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW], async (state) => {
    await removeToolIcon("actor", TOOL_ID);
    expect(state.updates[0].table).toBe(managedToolsTable);
    expect(state.updates[0].values.icon).toBe(null);
    expect(state.deletes).toEqual([]);
    expect(auditWrite(state).values.action).toBe("tool.icon-remove");
  });

  // With no URL, `resolveIcon` returns `renderIdenticon(toolId, name)`, so the
  // fallback a removal lands on is this generated SVG.
  expect(renderIdenticon(TOOL_ID, "Some Tool")).toMatch(/<svg/);
});

test("saving configured examples preserves their settings through content resolution", async () => {
  const example = {
    label: "Two colours",
    text: "#2563eb",
    secondary: "#7c3aed",
    settings: { angle: 135, stops: "", enabled: true },
  };
  await withFakeDatabase(
    [permissionRows({ tools: { view: true, edit: true } }), TOOL_ROW, TOOL_ROSTER],
    async (state) => {
      await updateToolContent("actor", TOOL_ID, {
        ...EMPTY_EDIT,
        contentDoc: { howToUse: ["Load the example"], examples: [example] },
      });
      const values = state.inserts.find((write) => write.table === toolContentTable).values;
      expect(values.contentDoc.examples).toEqual([example]);
      const spec = {
        toolId: TOOL_ID,
        category: CATEGORY,
        keywords: [],
        name: "Tool",
        description: "Description",
        content: { howToUse: ["Fallback"] },
      };
      expect(resolveContent(spec, { ...values, publishedAt: new Date() }).content.examples).toEqual([example]);
    },
  );
});
