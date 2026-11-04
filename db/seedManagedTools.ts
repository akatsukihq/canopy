import { readFile, readdir } from "node:fs/promises";
import { getPaperworkToolMessages } from "../lib/paperwork/toolMessages.ts";
import { isValidToolSlug, slugFromName, type ToolApp } from "../lib/tool-catalog/index.ts";
import { eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";
import { managedToolsTable, toolContentTable } from "./schema.ts";
import { resolveContent } from "../lib/tool-framework/content.ts";
import { escapeToolText, extractToolMessages, validateToolTranslation } from "../lib/tool-framework/translations.ts";
import type { ToolSpec } from "../lib/tool-framework/spec.ts";

type SeedToolApp = Extract<ToolApp, "devtools" | "media">;

type SeedToolSpec = ToolSpec & { app: SeedToolApp; slug: string };

interface LoadedToolDefinition {
  definitionKey: string;
  spec: SeedToolSpec;
}

export interface ManagedToolSeedScan {
  definitions: LoadedToolDefinition[];
  migrated: number;
  skipped: number;
  total: number;
}

export interface ManagedToolSeedCounts {
  migrated: number;
  skipped: number;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSeedToolApp(value: unknown): value is SeedToolApp {
  return value === "devtools" || value === "media";
}

function parseToolDefinition(definitionKey: string, value: unknown): SeedToolSpec {
  const location = `tools/${definitionKey}/definition.ts`;
  if (!isRecord(value)) {
    throw new Error(`✗ ${location}: default export must be an object literal.`);
  }
  if (!isSeedToolApp(value.app)) {
    throw new Error(`✗ ${location}: app must be "devtools" or "media".`);
  }

  const expectedToolId = `${value.app}.${definitionKey}`;
  if (value.toolId !== expectedToolId) {
    throw new Error(`✗ ${location}: toolId must be "${expectedToolId}" to match its app and folder.`);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error(`✗ ${location}: name must be a non-empty string.`);
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error(`✗ ${location}: description must be a non-empty string.`);
  }
  if (typeof value.category !== "string" || !value.category.trim()) {
    throw new Error(`✗ ${location}: category must be a non-empty string.`);
  }
  if (!Array.isArray(value.keywords) || !value.keywords.every((keyword) => typeof keyword === "string")) {
    throw new Error(`✗ ${location}: keywords must be an array of strings.`);
  }
  for (const field of ["input", "settings", "trigger", "labels", "content"]) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`✗ ${location}: default export is missing ${field}.`);
    }
  }
  if (Object.hasOwn(value, "slug") && value.slug !== undefined && typeof value.slug !== "string") {
    throw new Error(`✗ ${location}: slug must be a string when provided.`);
  }

  const slug = value.slug ?? slugFromName(value.name);
  if (!isValidToolSlug(value.app, slug)) {
    throw new Error(`✗ ${location}: slug "${slug}" is invalid or reserved.`);
  }

  return {
    ...(value as unknown as ToolSpec),
    toolId: expectedToolId,
    app: value.app,
    slug,
    name: value.name,
    description: value.description,
  };
}

export async function loadManagedToolDefinitions(): Promise<ManagedToolSeedScan> {
  const toolsDirectory = new URL("../tools/", import.meta.url);
  const folders = (await readdir(toolsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  const definitions: LoadedToolDefinition[] = [];
  let skipped = 0;

  for (const definitionKey of folders) {
    const definitionUrl = new URL(`${definitionKey}/definition.ts`, toolsDirectory);
    const source = await readFile(definitionUrl, "utf8");
    if (!/^\s*export\s+default\b/m.test(source)) {
      console.warn(`Skipping tools/${definitionKey}: definition.ts has no default export.`);
      skipped += 1;
      continue;
    }

    const imported = (await import(definitionUrl.href)) as Record<string, unknown>;
    if (!Object.hasOwn(imported, "default")) {
      console.warn(`Skipping tools/${definitionKey}: definition.ts has no default export.`);
      skipped += 1;
      continue;
    }

    definitions.push({
      definitionKey,
      spec: parseToolDefinition(definitionKey, imported.default),
    });
  }

  const result = {
    definitions,
    migrated: definitions.length,
    skipped,
    total: folders.length,
  };
  console.log(
    `Managed tool definitions: ${result.migrated} migrated / ${result.skipped} skipped / ${result.total} total folders.`,
  );
  return result;
}

export async function seedManagedTools(database: NodePgDatabase<typeof schema>): Promise<ManagedToolSeedCounts> {
  const scan = await loadManagedToolDefinitions();

  /**
   * `sort_order` is unique per app and existing rows keep whatever order they
   * were first seeded with, so a new tool cannot take its index in the folder
   * listing — that slot already belongs to whichever tool was inserted there.
   * New tools are appended after the current maximum instead.
   */
  const nextOrder = new Map<SeedToolApp, number>();
  for (const app of new Set(scan.definitions.map(({ spec }) => spec.app))) {
    const [row] = await database
      .select({ highest: max(managedToolsTable.order) })
      .from(managedToolsTable)
      .where(eq(managedToolsTable.app, app));
    nextOrder.set(app, (row?.highest ?? -1) + 1);
  }

  for (const { definitionKey, spec } of scan.definitions) {
    const [stored] = await database
      .select()
      .from(managedToolsTable)
      .where(eq(managedToolsTable.toolId, spec.toolId))
      .limit(1);

    if (stored && stored.slug !== spec.slug) {
      throw new Error(
        `✗ tools/${definitionKey}: definition declares slug "${spec.slug}" but the database\n` +
          `  has "${stored.slug}". Slugs are immutable once published. Revert the definition, or\n` +
          `  add a redirect and retire this tool under a new toolId.`,
      );
    }

    if (!stored) {
      const order = nextOrder.get(spec.app) ?? 0;
      nextOrder.set(spec.app, order + 1);
      await database
        .insert(managedToolsTable)
        .values({
          toolId: spec.toolId,
          app: spec.app,
          slug: spec.slug,
          name: spec.name,
          description: spec.description,
          order,
          enabled: true,
          translations: { en: { status: "published", messages: extractToolMessages(spec) } },
        })
        .onConflictDoNothing({ target: managedToolsTable.toolId });
    }

    await database
      .insert(toolContentTable)
      .values({ toolId: spec.toolId })
      .onConflictDoNothing({ target: toolContentTable.toolId });
  }

  await backfillToolTranslations(database, scan);

  return {
    migrated: scan.migrated,
    skipped: scan.skipped,
    total: scan.total,
  };
}

/** Initializes source translations only; does not create tools, templates, or assets. */
export async function backfillToolTranslations(
  database: NodePgDatabase<typeof schema>,
  loaded?: ManagedToolSeedScan,
): Promise<number> {
  const scan = loaded ?? (await loadManagedToolDefinitions());
  let updated = 0;
  // Backfill source copy without overwriting saved text, including a tool whose
  // English name existed before its code definition was deployed.
  const specs = new Map(scan.definitions.map(({ spec }) => [spec.toolId, spec]));
  const rows = await database.select({ toolId: managedToolsTable.toolId }).from(managedToolsTable);
  for (const { toolId } of rows) {
    await database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(managedToolsTable)
        .where(eq(managedToolsTable.toolId, toolId))
        .limit(1)
        .for("update");
      if (!row) return;
      const spec = specs.get(toolId);
      let source: Record<string, string> = {
        name: escapeToolText(row.name),
        description: escapeToolText(row.description),
        ...(row.app === "paperwork" ? getPaperworkToolMessages(row.toolId.split(".")[1] ?? row.toolId) : {}),
      };
      if (spec) {
        const [content] = await transaction
          .select()
          .from(toolContentTable)
          .where(eq(toolContentTable.toolId, toolId))
          .limit(1);
        const resolved = resolveContent({ ...spec, name: row.name, description: row.description }, content ?? null);
        source = extractToolMessages(
          {
            ...spec,
            name: row.name,
            description: row.description,
            keywords: resolved.keywords,
            content: resolved.content,
          },
          { seoTitle: resolved.seoTitle, seoDescription: resolved.seoDescription },
        );
      }
      const existing = row.translations?.en;
      // Keep admin-edited English only while it still fits the code's message (same placeholders/choices).
      const keep = (key: string, value: string) =>
        existing?.messages[key] !== undefined &&
        !validateToolTranslation("en", { [key]: existing.messages[key] }, { [key]: value }, { publish: true }).length;
      const messages = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [key, keep(key, value) ? existing!.messages[key] : value]),
      );
      if (
        existing &&
        JSON.stringify(Object.entries(existing.messages).sort()) === JSON.stringify(Object.entries(messages).sort())
      )
        return;
      const translations = Object.fromEntries(
        Object.entries(row.translations ?? {}).map(([locale, entry]) => [
          locale,
          { ...entry, status: "draft" as const },
        ]),
      );
      updated += 1;
      await transaction
        .update(managedToolsTable)
        .set({
          translations: {
            ...translations,
            en: {
              status: existing?.status ?? "published",
              messages,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(managedToolsTable.toolId, toolId));
    });
  }

  return updated;
}
