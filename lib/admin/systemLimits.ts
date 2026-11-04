/**
 * Admin edits to `system_limits`. A value is capped by its code constant (the
 * hard safety ceiling), so an admin can lower a limit but not raise it past it.
 */
import { db, eq, systemLimitsTable } from "../../db/index.ts";
import { CACHE_NAMESPACES } from "../cache/index.ts";
import { LIMIT_CEILINGS } from "../tool-framework/limits.ts";
import { DATABASE_SYSTEM_LIMITS } from "../tool-framework/systemLimits.ts";
import { invalidateAfterCommit, requireTransactionPermission, writeAudit } from "./adminMutations.ts";

/** A rejected value, shown beside the field. */
export class SystemLimitValueError extends Error {}

export async function updateSystemLimit(
  actorUserId: string,
  key: string,
  input: { value: unknown; updatedAt: unknown },
): Promise<{ value: number; updatedAt: string }> {
  const saved = await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "settings", "edit");
    if (!DATABASE_SYSTEM_LIMITS.includes(key)) throw new Error(`${key} is set in code and cannot be changed here.`);
    const value = input.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new SystemLimitValueError("Enter a whole number greater than zero.");
    }
    const ceiling = LIMIT_CEILINGS[key];
    if (ceiling !== undefined && value > ceiling) {
      throw new SystemLimitValueError(`The highest allowed value is ${ceiling.toLocaleString("en")}.`);
    }
    const [current] = await transaction
      .select()
      .from(systemLimitsTable)
      .where(eq(systemLimitsTable.key, key))
      .limit(1)
      .for("update");
    if (!current) throw new Error(`Unknown system limit: ${key}.`);
    if (typeof input.updatedAt !== "string" || current.updatedAt.toISOString() !== input.updatedAt) {
      throw new Error("This limit changed after you opened the page. Reload before saving again.");
    }
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    await transaction
      .update(systemLimitsTable)
      .set({ value, updatedAt: now })
      .where(eq(systemLimitsTable.key, key));
    await writeAudit(transaction, actorUserId, "system-limit.edit", "system-limit", key, {
      from: current.value,
      to: value,
    });
    return { value, updatedAt: now.toISOString() };
  });
  // Public specs are clamped when the catalog loads, so cached copies must go.
  return invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, saved);
}
