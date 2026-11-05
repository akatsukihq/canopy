/**
 * The application-side tool manifest.
 *
 * `lib/tool-catalog` is pure logic and holds no inventory, so somebody has
 * to answer "which tools exist?" for it. That is this module, and it obeys the
 * same invariant `catalog.ts` does:
 *
 *   ENUMERATION COMES FROM THE DATABASE, NEVER FROM THE BUNDLE.
 *
 * There is no generated registry, no `import.meta.glob`, no array of tools.
 * `managed_tools` is the only list. One entry per stored row, always — that is
 * what makes a row written by the admin "New tool" form manageable before its
 * folder is deployed, and what keeps the seven Paperwork tools (which predate
 * `tools/` and have no folder) in the manifest without hard-coding them.
 *
 * A row's *code* is then loaded by folder name via a dynamic import, which is a
 * lookup, not an enumeration: nothing here can tell you what folders exist,
 * only fetch one you already named. That lookup is also the only honest test of
 * whether a row's code has shipped, and it supplies the grouping label and
 * keywords the shipped definition owns.
 */

import { cache } from "react";

import { db, getToolContentRows, isDatabaseConfigured, managedToolsTable } from "../../db/index.ts";
import { mergeToolManifest, type ResolvedTool, type ToolManifestEntry } from "../tool-catalog/index.ts";

import { definitionKeyOf, specFromRow } from "./catalog";
import { TOOL_CATEGORIES } from "./categories";
import { hasDraftToolContent } from "./content.ts";

type ManagedToolRow = typeof managedToolsTable.$inferSelect;

/** A manifest entry plus whether the code half of the tool has shipped. */
interface ManifestRecord {
  readonly entry: ToolManifestEntry;
  readonly hasDefinition: boolean;
}

/** One resolved tool as the admin catalogue sees it: every stored row, always. */
export interface AdminTool extends ResolvedTool {
  /** False when the row has no valid stored spec. */
  readonly hasDefinition: boolean;
  readonly hasDraftContent: boolean;
  /** The raw stored spec, even when it does not validate. */
  readonly rawSpec: unknown | null;
  /** The raw unpublished spec edit; see `lib/admin/toolSpecDraft.ts`. */
  readonly specDraft: unknown | null;
  readonly hasSpecDraft: boolean;
  /** ISO timestamp of the row, for stale-edit checks. */
  readonly updatedAt: string;
}

const loadRows = cache(async (): Promise<readonly ManagedToolRow[]> => {
  if (!isDatabaseConfigured()) return [];

  const rows = await db.select().from(managedToolsTable);
  return [...rows].sort((left, right) =>
    left.app === right.app ? left.order - right.order : left.app.localeCompare(right.app),
  );
});

async function toRecord(row: ManagedToolRow): Promise<ManifestRecord> {
  const definitionKey = definitionKeyOf(row.toolId);
  // A missing, malformed, or other-app spec is as good as absent: it can never
  // serve this row's route.
  const shipped = definitionKey ? await specFromRow(row) : null;

  return {
    // Paperwork predates `tools/` and ships from `app/paperwork`, so it is not
    // waiting on a folder that will never exist.
    hasDefinition: row.app === "paperwork" || shipped !== null,
    entry: {
      id: row.toolId,
      app: row.app,
      componentKey: definitionKey ?? row.toolId,
      defaultName: shipped?.name ?? row.name,
      defaultDescription: shipped?.description ?? row.description,
      ...(shipped
        ? {
            category: TOOL_CATEGORIES[shipped.category]?.label,
            keywords: shipped.keywords,
          }
        : {}),
    },
  };
}

const loadRecords = cache(async (): Promise<readonly ManifestRecord[]> =>
  Promise.all((await loadRows()).map(toRecord)),
);

/**
 * The manifest every `mergeToolManifest` caller passes in.
 *
 * One entry per stored row, so the merge's "drop unknown toolIds" rule stays
 * intact while dropping nothing that actually exists.
 */
export const getToolManifest = cache(async (): Promise<readonly ToolManifestEntry[]> =>
  (await loadRecords()).map((record) => record.entry),
);

/**
 * The admin catalogue's enumerator.
 *
 * Admin manages database rows, so it must see every row — including one whose
 * spec is missing or invalid. Those surface as `hasDefinition: false` rather
 * than vanishing; the public catalogue still hides them, because `catalog.ts`
 * drops any row without a valid stored spec.
 */
export const getAdminTools = cache(async (): Promise<readonly AdminTool[]> => {
  const [rows, records, contentRows] = await Promise.all([
    loadRows(),
    loadRecords(),
    isDatabaseConfigured() ? getToolContentRows() : Promise.resolve([]),
  ]);
  const draftIds = new Set(contentRows.filter(hasDraftToolContent).map((row) => row.toolId));
  const shippedById = new Map(records.map((record) => [record.entry.id, record.hasDefinition] as const));
  const rowsById = new Map(rows.map((row) => [row.toolId, row] as const));

  return mergeToolManifest(
    rows,
    records.map((record) => record.entry),
  ).map((tool) => {
    const row = rowsById.get(tool.id);
    return {
      ...tool,
      hasDefinition: shippedById.get(tool.id) ?? false,
      hasDraftContent: draftIds.has(tool.id),
      rawSpec: row?.spec ?? null,
      specDraft: row?.specDraft ?? null,
      hasSpecDraft: row?.specDraft != null,
      updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
    };
  });
});
