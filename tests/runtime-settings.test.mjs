import { afterEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { db } from "../db/index.ts";
import { RuntimeSettingValueError, saveSettings, updateRuntimeSetting } from "../lib/admin/runtimeSettings.ts";
import { resolveRuntimeSettings } from "../lib/config/runtimeSettings.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

test("env supplies defaults; a valid override wins; an invalid stored value falls back to env", () => {
  process.env.AI_ENABLED = "false";
  process.env.OPENAI_MODEL = "gpt-5.5";
  const env = resolveRuntimeSettings(new Map());
  expect(env["ai.enabled"]).toMatchObject({ value: false, source: "env" });
  expect(env["ai.openaiModel"]).toMatchObject({ value: "gpt-5.5", source: "env" });

  const over = resolveRuntimeSettings(
    new Map([
      ["ai.enabled", true],
      ["ai.openaiModel", "not a model!"],
    ]),
  );
  expect(over["ai.enabled"]).toMatchObject({ value: true, source: "admin", envValue: false });
  expect(over["ai.openaiModel"]).toMatchObject({ value: "gpt-5.5", source: "env" });
});

async function withDatabase(callback, access = { edit: true }, current) {
  const writes = [];
  const original = db.transaction;
  const reads = [
    [
      {
        status: "active",
        roleId: "ops",
        roleName: "Ops",
        roleDescription: "Platform settings",
        roleAccess: { admin: { enter: true }, settings: { view: true, ...access } },
        roleIsSystem: false,
      },
    ],
    current ? [current] : [],
  ];
  const transaction = {
    select() {
      const result = reads.shift() ?? [];
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        for: () => chain,
        then: (resolve) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
    insert(table) {
      const entry = { kind: "insert", table };
      writes.push(entry);
      return {
        values: (values) => {
          entry.values = values;
          return { onConflictDoUpdate: async () => {}, then: (resolve) => Promise.resolve().then(resolve) };
        },
      };
    },
    delete(table) {
      writes.push({ kind: "delete", table });
      return { where: async () => {} };
    },
  };
  db.transaction = async (run) => run(transaction);
  try {
    return await callback(writes);
  } finally {
    db.transaction = original;
  }
}

test("saves an override and audits from/to", async () => {
  await withDatabase(
    async (writes) => {
      await updateRuntimeSetting("u1", "ai.openaiModel", "gpt-5.6-terra");
      const [setting, audit] = writes.filter((w) => w.kind === "insert");
      expect(setting.values).toMatchObject({ key: "ai.openaiModel", value: "gpt-5.6-terra", updatedBy: "u1" });
      expect(audit.values).toMatchObject({ action: "platform-setting.edit", targetId: "ai.openaiModel" });
      expect(audit.values.metadata).toEqual({ from: "gpt-5.5", to: "gpt-5.6-terra" });
    },
    { edit: true },
    { key: "ai.openaiModel", value: "gpt-5.5" },
  );
});

test("null clears the override and is audited", async () => {
  await withDatabase(
    async (writes) => {
      await updateRuntimeSetting("u1", "ai.enabled", null);
      expect(writes.some((w) => w.kind === "delete")).toBe(true);
      expect(writes.find((w) => w.kind === "insert").values.metadata).toEqual({ from: true, to: null });
    },
    { edit: true },
    { key: "ai.enabled", value: true },
  );
});

test("rejects malformed values, unknown keys, and missing permission without writing", async () => {
  await withDatabase(async (writes) => {
    await expect(updateRuntimeSetting("u1", "ai.titleModel", "not a model!")).rejects.toBeInstanceOf(
      RuntimeSettingValueError,
    );
    expect(writes).toEqual([]);
  });
  await withDatabase(async () => {
    await expect(updateRuntimeSetting("u1", "ai.enabled", "yes")).rejects.toBeInstanceOf(RuntimeSettingValueError);
  });
  await withDatabase(async () => {
    await expect(updateRuntimeSetting("u1", "auth.secret", "x")).rejects.toThrow(/cannot be changed/);
  });
  await withDatabase(
    async (writes) => {
      await expect(updateRuntimeSetting("u1", "ai.enabled", true)).rejects.toThrow(/settings\.edit/);
      expect(writes).toEqual([]);
    },
    { edit: false },
  );
});

test("rate limits and support email: form strings are coerced and bounded", async () => {
  await withDatabase(async (writes) => {
    await updateRuntimeSetting("u1", "traffic.toolRequestsPerMinute", "45");
    expect(writes.find((w) => w.kind === "insert").values).toMatchObject({ value: 45 });
  });
  for (const bad of ["0", "121", "2.5", "", "lots"]) {
    await withDatabase(async (writes) => {
      await expect(updateRuntimeSetting("u1", "traffic.toolRequestsPerMinute", bad)).rejects.toBeInstanceOf(
        RuntimeSettingValueError,
      );
      expect(writes).toEqual([]);
    });
  }
  await withDatabase(async (writes) => {
    await updateRuntimeSetting("u1", "site.supportEmail", "  help@example.com ");
    expect(writes.find((w) => w.kind === "insert").values).toMatchObject({ value: "help@example.com" });
  });
  await withDatabase(async () => {
    await expect(updateRuntimeSetting("u1", "site.supportEmail", "not an email")).rejects.toBeInstanceOf(
      RuntimeSettingValueError,
    );
  });
  const resolved = resolveRuntimeSettings(new Map([["traffic.codeRunsPerMinute", 500]]));
  expect(resolved["traffic.codeRunsPerMinute"]).toMatchObject({ value: 10, source: "env" });
});

test("saving a page applies every change and names the field a bad value came from", async () => {
  await withDatabase(async (writes) => {
    await saveSettings("u1", { limits: [], runtime: [{ key: "ai.enabled", value: true }] });
    expect(writes.find((w) => w.kind === "insert").values).toMatchObject({ key: "ai.enabled", value: true });
  });
  await withDatabase(async (writes) => {
    const error = await saveSettings("u1", {
      limits: [],
      runtime: [{ key: "traffic.codeRunsPerMinute", value: "999" }],
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(RuntimeSettingValueError);
    expect(error.key).toBe("traffic.codeRunsPerMinute");
    expect(writes).toEqual([]);
  });
  await withDatabase(
    async (writes) => {
      await expect(saveSettings("u1", { limits: [], runtime: [{ key: "ai.enabled", value: true }] })).rejects.toThrow(
        /settings\.edit/,
      );
      expect(writes).toEqual([]);
    },
    { edit: false },
  );
});
