import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { db } from "../db/index.ts";
import { SystemLimitValueError, updateSystemLimit } from "../lib/admin/systemLimits.ts";

const UPDATED_AT = new Date("2026-10-01T09:00:00.000Z");

function permissionRows(settings) {
  return [
    {
      status: "active",
      roleId: "ops",
      roleName: "Ops",
      roleDescription: "Platform settings",
      roleAccess: { admin: { enter: true }, settings: { view: true, ...settings } },
      roleIsSystem: false,
    },
  ];
}

async function withDatabase(callback, settings = { edit: true }) {
  const writes = [];
  const original = db.transaction;
  const row = { key: "platform_max_bytes", value: 104857600, unit: "bytes", description: "", updatedAt: UPDATED_AT };
  const reads = [permissionRows(settings), [row]];
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
    update(table) {
      const entry = { kind: "update", table };
      writes.push(entry);
      const chain = { set: (values) => ((entry.values = values), chain), where: async () => [] };
      return chain;
    },
    insert(table) {
      return { values: async (values) => void writes.push({ kind: "insert", table, values }) };
    },
  };
  db.transaction = async (run) => run(transaction);
  try {
    return await callback(writes);
  } finally {
    db.transaction = original;
  }
}

test("saves a database-backed limit, audits the change, and returns a newer timestamp", async () => {
  await withDatabase(async (writes) => {
    const saved = await updateSystemLimit("u1", "platform_max_bytes", {
      value: 50 * 1024 * 1024,
      updatedAt: UPDATED_AT.toISOString(),
    });
    expect(saved.value).toBe(52428800);
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(UPDATED_AT.getTime());
    expect(writes.find((w) => w.kind === "update").values.value).toBe(52428800);
    const audit = writes.find((w) => w.kind === "insert").values;
    expect(audit.action).toBe("system-limit.edit");
    expect(audit.metadata).toEqual({ from: 104857600, to: 52428800 });
  });
});

test("rejects invalid values, code-owned limits, stale edits, and missing permission", async () => {
  const fresh = UPDATED_AT.toISOString();
  for (const value of [0, -1, 1.5, "10", Number.MAX_SAFE_INTEGER + 1]) {
    await withDatabase(async (writes) => {
      await expect(updateSystemLimit("u1", "platform_max_bytes", { value, updatedAt: fresh })).rejects.toBeInstanceOf(
        SystemLimitValueError,
      );
      expect(writes).toEqual([]);
    });
  }
  await withDatabase(async () => {
    await expect(updateSystemLimit("u1", "progress_interval_ms", { value: 10, updatedAt: fresh })).rejects.toThrow(
      /set in code/,
    );
  });
  await withDatabase(async (writes) => {
    await expect(
      updateSystemLimit("u1", "platform_max_bytes", { value: 104857601, updatedAt: fresh }),
    ).rejects.toThrow(/highest allowed value is 104,857,600/);
    expect(writes).toEqual([]);
  });
  await withDatabase(async (writes) => {
    await expect(
      updateSystemLimit("u1", "platform_max_bytes", { value: 10, updatedAt: "2026-01-01T00:00:00.000Z" }),
    ).rejects.toThrow(/changed after you opened/);
    expect(writes).toEqual([]);
  });
  await withDatabase(
    async () => {
      await expect(updateSystemLimit("u1", "platform_max_bytes", { value: 10, updatedAt: fresh })).rejects.toThrow(
        /settings\.edit/,
      );
    },
    { edit: false },
  );
});
