import { cache } from "react";

import { db, isDatabaseConfigured, systemLimitsTable } from "../../db/index.ts";
import type { ToolSpec } from "./spec";

/** Platform-wide caps from `system_limits`, keyed by limit name. */
export type SystemLimits = Readonly<Record<string, number>>;

/**
 * The limits this module reads from the database. The other `system_limits`
 * rows are still enforced by the constants in `./limits.ts`, so Admin shows
 * them read-only.
 */
export const DATABASE_SYSTEM_LIMITS: readonly string[] = ["platform_max_bytes", "max_editable_text_chars"];

type LimitCheck = { readonly path: string; readonly value: number | undefined; readonly limit: string };

/** One database read per request; admin edits apply on the next request. */
export const loadSystemLimits = cache(async (): Promise<SystemLimits> => {
  if (!isDatabaseConfigured()) return {};
  const rows = await db.select({ key: systemLimitsTable.key, value: systemLimitsTable.value }).from(systemLimitsTable);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
});

function limitChecks(spec: ToolSpec): LimitCheck[] {
  const input = spec.input;
  if (input.kind === "text") {
    return [
      { path: "input.maxLength", value: input.maxLength, limit: "max_editable_text_chars" },
      { path: "input.acceptFiles.maxBytes", value: input.acceptFiles?.maxBytes, limit: "platform_max_bytes" },
      {
        path: "input.acceptFiles.maxEditableBytes",
        value: input.acceptFiles?.maxEditableBytes,
        limit: "max_editable_text_chars",
      },
    ];
  }
  if (input.kind === "fields") {
    return input.fields.map((field, index) => ({
      path: `input.fields.${index}.maxLength`,
      value: field.maxLength,
      limit: "max_editable_text_chars",
    }));
  }
  if (input.kind === "files") {
    return [
      { path: "input.maxBytes", value: input.maxBytes, limit: "platform_max_bytes" },
      { path: "input.maxTotalBytes", value: input.maxTotalBytes, limit: "platform_max_bytes" },
    ];
  }
  return [];
}

/** Save-time check: every tool limit above its system limit, as readable messages. */
export function limitViolations(spec: ToolSpec, limits: SystemLimits): string[] {
  return limitChecks(spec).flatMap(({ path, value, limit }) => {
    const cap = limits[limit];
    return value !== undefined && cap !== undefined && value > cap
      ? [`${path} ${value.toLocaleString("en")} exceeds ${limit} ${cap.toLocaleString("en")}`]
      : [];
  });
}

const clamp = (value: number | undefined, cap: number | undefined) =>
  value === undefined || cap === undefined ? value : Math.min(value, cap);

/** Runtime guard: a spec written outside Admin still cannot exceed a system limit. */
export function clampSpecLimits(spec: ToolSpec, limits: SystemLimits): ToolSpec {
  const input = spec.input;
  const text = limits.max_editable_text_chars;
  const bytes = limits.platform_max_bytes;
  if (input.kind === "text") {
    return {
      ...spec,
      input: {
        ...input,
        maxLength: clamp(input.maxLength, text),
        acceptFiles: input.acceptFiles && {
          ...input.acceptFiles,
          maxBytes: clamp(input.acceptFiles.maxBytes, bytes)!,
          maxEditableBytes: clamp(input.acceptFiles.maxEditableBytes, text),
        },
      },
    };
  }
  if (input.kind === "fields") {
    return {
      ...spec,
      input: { ...input, fields: input.fields.map((field) => ({ ...field, maxLength: clamp(field.maxLength, text) })) },
    };
  }
  if (input.kind === "files") {
    return {
      ...spec,
      input: { ...input, maxBytes: clamp(input.maxBytes, bytes), maxTotalBytes: clamp(input.maxTotalBytes, bytes) },
    };
  }
  return spec;
}
