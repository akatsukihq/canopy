/**
 * Server-side catalogue: the one place that answers "which tools exist?".
 *
 * The invariant this module exists to protect:
 *
 *   ENUMERATION COMES FROM THE DATABASE, NEVER FROM THE BUNDLE.
 *
 * There is no generated registry, no `import.meta.glob`, no array of tools.
 * `managed_tools` is the only list. A tool's *code* is then loaded by folder
 * name via a dynamic import, which is a lookup, not an enumeration: nothing
 * here can tell you what folders exist, only fetch one you already named.
 *
 * Resolution order, and it is load-bearing:
 *
 *   URL slug -> managed_tools row -> toolId -> definitionKey -> tools/<key>/
 *                                              ^ toolId.split(".")[1]
 *
 * The folder is NEVER derived from the slug. Slugs are derived from names and
 * are admin-editable, so plenty of live tools have a slug that differs from
 * their folder name; deriving one from the other 404s them.
 *
 * React's request-only `cache()` shares repeated reads without delaying
 * publication changes. Discovery loads only the requested app/languages;
 * complete locale coverage is reserved for detail metadata and sitemaps.
 */

import { cache } from "react";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { getPaperworkToolMessages, resolvePaperworkTranslation } from "../paperwork/toolMessages.ts";
import { defaultLocale, isLocale, localizeHref, locales, type Locale } from "../i18n/config.ts";
import { getCommonMessages } from "../i18n/messages.ts";
import {
  applyToolMessages,
  extractToolMessages,
  resolveToolTranslation,
  formatToolMessage,
  escapeToolText,
  type ToolMessages,
  type ToolTranslations,
} from "./translations.ts";

import {
  db,
  getToolContentRows,
  isDatabaseConfigured,
  managedToolsTable,
  toolContentTable,
  type ToolContentRow,
} from "../../db/index.ts";
import { getEnabledTools, isToolAvailable, isValidToolSlug, mergeToolManifest } from "../tool-catalog/index.ts";
import type { ToolApp as PublicToolApp } from "../tool-catalog/index.ts";

import type { CategoryKey, ToolApp } from "./categories";
import { resolveContent } from "./content";
import { resolveIcon, type ResolvedIcon } from "./icons";
import type { ToolContent, ToolSpec } from "./spec";
import { parseToolSpec } from "./specSchema";
import { clampSpecLimits, loadSystemLimits } from "./systemLimits.ts";

/** How many tools `relatedTools` returns, matching the tool page's shelf. */
const RELATED_LIMIT = 3;

/** A definition key is a directory name; anything else is not importable. */
const DEFINITION_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type ManagedToolRow = typeof managedToolsTable.$inferSelect;

/** One fully resolved tool: shipped declaration + admin-authored overrides. */
export type CatalogTool = {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly messages: ToolMessages;
  readonly toolId: string;
  readonly app: ToolApp;
  /** Public URL segment. Admin-owned, and not the folder name. */
  readonly slug: string;
  /** Folder under `tools/`. Derived from `toolId`, never from `slug`. */
  readonly definitionKey: string;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly category: CategoryKey;
  readonly keywords: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly content: ToolContent;
  readonly icon: ResolvedIcon;
  readonly href: string;
  readonly spec: ToolSpec;
};

/** Public discovery data shared by search and ecosystem navigation. */
export type PublicTool = Pick<CatalogTool, "toolId" | "name" | "description" | "href" | "icon" | "keywords"> & {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly app: PublicToolApp;
  readonly category: string;
  readonly categoryKey: CategoryKey | null;
};

/** Cards do not need a translated workspace or a complete language inventory. */
export type CatalogToolListing = Pick<
  CatalogTool,
  | "locale"
  | "toolId"
  | "app"
  | "slug"
  | "definitionKey"
  | "name"
  | "description"
  | "order"
  | "category"
  | "keywords"
  | "icon"
  | "href"
>;
export type PublicToolListing = Omit<PublicTool, "availableLocales">;

export function definitionKeyOf(toolId: string): string | null {
  const key = toolId.split(".")[1] ?? "";
  return DEFINITION_KEY_PATTERN.test(key) ? key : null;
}

/**
 * A row's stored definition, validated by `parseToolSpec` and clamped to the system limits.
 *
 * Returns `null` rather than throwing: a row with a missing or malformed spec
 * must drop out of the catalogue, not break every page that lists it.
 */
export async function specFromRow(row: Pick<ManagedToolRow, "toolId" | "app" | "spec">): Promise<ToolSpec | null> {
  const parsed = parseToolSpec(row.spec);
  if (!parsed.ok) {
    if (row.spec != null) console.error(`Invalid stored spec for ${row.toolId}: ${parsed.issues.join("; ")}`);
    return null;
  }
  if (parsed.spec.toolId !== row.toolId || parsed.spec.app !== row.app) return null;
  return clampSpecLimits(parsed.spec, await loadSystemLimits());
}

/** Loads one tool's stored definition by stable tool ID. */
export async function loadSpec(toolId: string): Promise<ToolSpec | null> {
  if (!isDatabaseConfigured()) return null;
  const [row] = await db
    .select({ toolId: managedToolsTable.toolId, app: managedToolsTable.app, spec: managedToolsTable.spec })
    .from(managedToolsTable)
    .where(eq(managedToolsTable.toolId, toolId))
    .limit(1);
  return row ? specFromRow(row) : null;
}

/** Loads the stored definition of the code folder `tools/<definitionKey>`. */
export async function loadSpecByDefinitionKey(definitionKey: string): Promise<ToolSpec | null> {
  if (!DEFINITION_KEY_PATTERN.test(definitionKey)) return null;
  for (const app of ["devtools", "media"] as const) {
    const spec = await loadSpec(`${app}.${definitionKey}`);
    if (spec) return spec;
  }
  return null;
}

async function resolveToolSource(row: ManagedToolRow & { slug: string }, contentRow: ToolContentRow | null) {
  const definitionKey = definitionKeyOf(row.toolId);
  if (!definitionKey) return null;

  const spec = await specFromRow(row);
  if (!spec) return null;

  // The admin-authored name/description are the live ones, so they, not the
  // shipped strings, are what the SEO fields fall back to.
  const resolved = resolveContent({ ...spec, name: row.name, description: row.description }, contentRow);
  const sourceSpec = {
    ...spec,
    name: row.name,
    description: row.description,
    category: resolved.category,
    keywords: resolved.keywords,
    content: resolved.content,
  };
  return { definitionKey, spec, resolved, sourceSpec };
}

async function buildTool(
  row: ManagedToolRow & { slug: string },
  contentRow: ToolContentRow | null,
  requestedLocale: Locale,
): Promise<CatalogTool | null> {
  const source = await resolveToolSource(row, contentRow);
  if (!source) return null;
  const { definitionKey, spec, resolved, sourceSpec } = source;
  const required = extractToolMessages(sourceSpec, resolved);
  const requested = resolveToolTranslation(row.translations, requestedLocale, required);
  const translation = requested ?? resolveToolTranslation(row.translations, defaultLocale, required);
  if (!translation) return null;
  const locale = requested ? requestedLocale : defaultLocale;
  const localizedSpec = applyToolMessages(sourceSpec, translation.messages, locale);

  return {
    locale,
    availableLocales: translation.availableLocales,
    messages: translation.messages,
    toolId: row.toolId,
    app: spec.app,
    slug: row.slug,
    definitionKey,
    name: localizedSpec.name,
    description: localizedSpec.description,
    order: row.order,
    category: resolved.category,
    keywords: localizedSpec.keywords,
    seoTitle: formatToolMessage(locale, translation.messages.seoTitle!),
    seoDescription: formatToolMessage(locale, translation.messages.seoDescription!),
    content: localizedSpec.content,
    icon: resolveIcon(row.toolId, row.name, row.icon),
    href: localizeHref(`/${spec.app}/${row.slug}`, locale),
    spec: { ...localizedSpec, messages: undefined },
  };
}

/** Filter before transferring JSON or loading definitions; one consistent DB read. */
const loadDiscoveryRows = cache(
  async (locale: Locale, app?: PublicToolApp, slug?: string, toolId?: string, allLocales = false) => {
    if (!isDatabaseConfigured()) return [];
    const columns = getTableColumns(managedToolsTable);
    return db
      .select({
        tool: {
          ...columns,
          translations: allLocales
            ? columns.translations
            : sql<ToolTranslations>`jsonb_build_object('en', ${columns.translations}->'en', ${locale}::text, ${columns.translations}->${locale}::text)`,
        },
        content: toolContentTable,
      })
      .from(managedToolsTable)
      .leftJoin(toolContentTable, eq(toolContentTable.toolId, managedToolsTable.toolId))
      .where(
        and(
          eq(managedToolsTable.enabled, true),
          eq(managedToolsTable.archived, false),
          app ? eq(managedToolsTable.app, app) : undefined,
          slug !== undefined ? eq(managedToolsTable.slug, slug) : undefined,
          toolId !== undefined ? eq(managedToolsTable.toolId, toolId) : undefined,
        ),
      );
  },
);

/** Publishing validates the complete contract. Discovery only reads the visible card. */
function resolveListingText(translations: ToolTranslations, locale: Locale, keywordCount = 0) {
  const format = (candidate: Locale) => {
    const translation = translations?.[candidate];
    if (translation?.status !== "published" || !translation.messages || typeof translation.messages !== "object")
      return null;
    const text = (key: string) => {
      const message = translation.messages[key];
      if (typeof message !== "string" || !message.trim()) throw new Error("Missing card text");
      return formatToolMessage(candidate, message);
    };
    try {
      return {
        locale: candidate,
        name: text("name"),
        description: text("description"),
        keywords: Array.from({ length: keywordCount }, (_, index) => text(`keywords.${index}`)),
      };
    } catch {
      return null;
    }
  };
  const english = format(defaultLocale);
  if (!english || locale === defaultLocale) return english;
  return format(locale) ?? english;
}

async function buildToolListing(
  row: ManagedToolRow & { slug: string },
  contentRow: ToolContentRow | null,
  requestedLocale: Locale,
): Promise<CatalogToolListing | null> {
  // Cards use category/keywords, never the body or workspace contract.
  const source = await resolveToolSource(row, contentRow ? { ...contentRow, contentDoc: null } : null);
  if (!source) return null;
  const text = resolveListingText(row.translations, requestedLocale, source.sourceSpec.keywords.length);
  if (!text) return null;
  return {
    toolId: row.toolId,
    app: source.spec.app,
    slug: row.slug,
    definitionKey: source.definitionKey,
    order: row.order,
    category: source.resolved.category,
    ...text,
    icon: resolveIcon(row.toolId, row.name, row.icon),
    href: localizeHref(`/${source.spec.app}/${row.slug}`, text.locale),
  };
}

const loadToolListings = cache(async (app: ToolApp | undefined, locale: Locale) => {
  const rows = app
    ? await loadDiscoveryRows(locale, app)
    : (await Promise.all([loadDiscoveryRows(locale, "devtools"), loadDiscoveryRows(locale, "media")])).flat();
  const built = await Promise.all(
    rows.flatMap(({ tool, content }) =>
      tool.app !== "paperwork" && isToolAvailable(tool) && isValidToolSlug(tool.app, tool.slug)
        ? [buildToolListing(tool, content, locale)]
        : [],
    ),
  );
  return built
    .filter((tool): tool is CatalogToolListing => tool !== null)
    .sort((left, right) => (left.app === right.app ? left.order - right.order : left.app.localeCompare(right.app)));
});

export const getToolListings = cache(
  async (app: ToolApp, locale: Locale = defaultLocale): Promise<readonly CatalogToolListing[]> =>
    loadToolListings(app, locale),
);

export const getPublicToolListings = cache(
  async (locale: Locale = defaultLocale, app?: PublicToolApp): Promise<readonly PublicToolListing[]> => {
    const [tools, rows] = await Promise.all([
      app === "paperwork" ? Promise.resolve([]) : loadToolListings(app, locale),
      !app || app === "paperwork" ? loadDiscoveryRows(locale, "paperwork") : Promise.resolve([]),
    ]);
    const common = getCommonMessages(locale);
    return [
      ...tools.map((tool) => ({
        toolId: tool.toolId,
        app: tool.app,
        name: tool.name,
        description: tool.description,
        href: tool.href,
        icon: tool.icon,
        keywords: tool.keywords,
        category: common.Categories[tool.category],
        categoryKey: tool.category,
        locale: tool.locale,
      })),
      ...rows
        .sort((left, right) => left.tool.order - right.tool.order)
        .flatMap(({ tool }) => {
          if (tool.app !== "paperwork" || !isToolAvailable(tool) || !isValidToolSlug(tool.app, tool.slug)) return [];
          const text = resolveListingText(tool.translations, locale);
          if (!text) return [];
          return [
            {
              toolId: tool.toolId,
              app: tool.app,
              ...text,
              href: localizeHref(`/paperwork/${tool.slug}`, text.locale),
              icon: resolveIcon(tool.toolId, text.name, tool.icon),
              category: common.Common.documents,
              categoryKey: null,
            },
          ];
        }),
    ];
  },
);

/** Share queries within a request while making publication visible across app instances. */
const loadCatalog = cache(async (locale: Locale = defaultLocale, app?: PublicToolApp) => {
  if (!isDatabaseConfigured()) return { tools: [], paperworkTools: [], publicTools: [] };

  const load = async () => {
    const rowQuery = db.select().from(managedToolsTable);
    const [rows, contentRows] = await Promise.all([
      app ? rowQuery.where(eq(managedToolsTable.app, app)) : rowQuery,
      app === "paperwork" ? Promise.resolve([]) : getToolContentRows(),
    ]);
    const contentByToolId = new Map(
      contentRows.filter((row) => row.publishedAt !== null).map((row) => [row.toolId, row] as const),
    );
    const built = await Promise.all(
      rows
        .filter(isToolAvailable)
        .filter((row) => row.app !== "paperwork" && isValidToolSlug(row.app, row.slug))
        .map((row) => buildTool(row, contentByToolId.get(row.toolId) ?? null, locale)),
    );
    const tools = built
      .filter((tool): tool is CatalogTool => tool !== null)
      .sort((left, right) => (left.app === right.app ? left.order - right.order : left.app.localeCompare(right.app)));

    // Paperwork's route implementations predate tools/*; preserve its existing manifest merge rules.
    const paperworkRows = rows
      .filter((row) => row.app === "paperwork")
      .flatMap((row) => {
        const required = {
          name: escapeToolText(row.name),
          description: escapeToolText(row.description),
          ...getPaperworkToolMessages(definitionKeyOf(row.toolId) ?? row.toolId),
        };
        const componentKey = definitionKeyOf(row.toolId) ?? row.toolId;
        const requested = resolvePaperworkTranslation(row.translations, componentKey, locale, required);
        const translation =
          requested ?? resolvePaperworkTranslation(row.translations, componentKey, defaultLocale, required);
        if (!translation) return [];
        const resolvedLocale = requested ? locale : defaultLocale;
        return [
          {
            ...row,
            name: formatToolMessage(resolvedLocale, translation.messages.name!),
            description: formatToolMessage(resolvedLocale, translation.messages.description!),
            locale: resolvedLocale,
            availableLocales: translation.availableLocales,
            messages: translation.messages,
          },
        ];
      });
    const paperworkTools = getEnabledTools(
      mergeToolManifest(
        paperworkRows,
        paperworkRows.map((row) => ({
          id: row.toolId,
          app: row.app,
          componentKey: definitionKeyOf(row.toolId) ?? row.toolId,
          defaultName: row.name,
          defaultDescription: row.description,
        })),
      ),
      "paperwork",
    ).map((tool) => {
      const translation = paperworkRows.find((row) => row.toolId === tool.id)!;
      return {
        ...tool,
        locale: translation.locale,
        availableLocales: translation.availableLocales,
        messages: translation.messages,
        href: localizeHref(`/paperwork/${tool.slug}`, translation.locale),
      };
    });
    const publicTools: PublicTool[] = [
      ...tools.map((tool) => ({
        toolId: tool.toolId,
        app: tool.app,
        name: tool.name,
        description: tool.description,
        href: tool.href,
        icon: tool.icon,
        keywords: tool.keywords,
        category: getCommonMessages(locale).Categories[tool.category],
        categoryKey: tool.category,
        locale: tool.locale,
        availableLocales: tool.availableLocales,
      })),
      ...paperworkTools.map((tool) => ({
        toolId: tool.toolId,
        app: tool.app,
        name: tool.name,
        description: tool.description,
        href: tool.href,
        icon: resolveIcon(tool.toolId, tool.name, tool.icon),
        keywords: tool.keywords ?? [],
        category: getCommonMessages(locale).Common.documents,
        categoryKey: null,
        locale: tool.locale,
        availableLocales: tool.availableLocales,
      })),
    ];
    return { tools, paperworkTools, publicTools };
  };
  // Request-only caching makes admin publication visible on every app instance.
  return load();
});

/**
 * Sitemap URLs only: enabled, non-archived tools and the locales whose
 * translation is marked published. Publishing already validates the full
 * contract, so this skips re-parsing specs and translations per request.
 * English must be published, since every other locale falls back to it.
 */
export async function getSitemapTools(): Promise<readonly { href: string; availableLocales: Locale[] }[]> {
  if (!isDatabaseConfigured()) return [];
  const published = sql<string[]>`COALESCE((
    SELECT jsonb_agg(t.key) FROM jsonb_each(${managedToolsTable.translations}) t
    WHERE t.value->>'status' = 'published'
  ), '[]'::jsonb)`;
  const rows = await db
    .select({ app: managedToolsTable.app, slug: managedToolsTable.slug, published })
    .from(managedToolsTable)
    .where(and(eq(managedToolsTable.enabled, true), eq(managedToolsTable.archived, false)))
    .orderBy(managedToolsTable.app, managedToolsTable.order);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(`${row.app}/${row.slug}`, (counts.get(`${row.app}/${row.slug}`) ?? 0) + 1);
  return rows.flatMap((row) => {
    if (!row.slug || !isValidToolSlug(row.app, row.slug) || counts.get(`${row.app}/${row.slug}`) !== 1) return [];
    const have = new Set(row.published.filter(isLocale));
    if (!have.has(defaultLocale)) return [];
    return [{ href: `/${row.app}/${row.slug}`, availableLocales: locales.filter((l) => have.has(l)) }];
  });
}

/** Every enabled, non-archived, slugged tool. Optionally narrowed to one app. */
export const getTools = cache(
  async (app?: ToolApp, locale: Locale = defaultLocale): Promise<readonly CatalogTool[]> => {
    const { tools } = await loadCatalog(locale, app);
    return app ? tools.filter((tool) => tool.app === app) : tools;
  },
);

export const getPaperworkTools = cache(
  async (locale: Locale = defaultLocale) => (await loadCatalog(locale, "paperwork")).paperworkTools,
);

export const getPublicTools = cache(
  async (locale: Locale = defaultLocale): Promise<readonly PublicTool[]> => (await loadCatalog(locale)).publicTools,
);

/**
 * Resolves a public URL to a tool.
 *
 * An ambiguous slug resolves to nothing rather than to an arbitrary winner —
 * the same guard `findAvailableToolBySlug` applies, for the same reason.
 */
export const resolveToolPage = cache(
  async (app: ToolApp, slug: string, locale: Locale = defaultLocale): Promise<CatalogTool | null> => {
    if (!isValidToolSlug(app, slug)) return null;
    const rows = await loadDiscoveryRows(locale, app, slug, undefined, true);
    if (rows.length !== 1 || !isToolAvailable(rows[0].tool)) return null;
    const tool = await buildTool(rows[0].tool, rows[0].content, locale);
    return tool?.locale === locale ? tool : null;
  },
);

/**
 * Curated related tools, falling back to the rest of the same category.
 */
export const relatedTools = cache(
  async (toolId: string, locale: Locale = defaultLocale): Promise<readonly CatalogToolListing[]> => {
    const rows = await loadDiscoveryRows(locale, undefined, undefined, toolId);
    const row = rows[0];
    if (!row || row.tool.app === "paperwork" || !isToolAvailable(row.tool)) return [];
    const source = await resolveToolSource(row.tool, row.content);
    if (!source) return [];
    const tools = await loadToolListings(undefined, locale);
    const tool = tools.find((candidate) => candidate.toolId === toolId);
    if (!tool) return [];

    const curated = (source.resolved.content.relatedToolIds ?? [])
      .filter((id) => id !== toolId)
      .flatMap((id) => tools.filter((candidate) => candidate.toolId === id));

    const seen = new Set(curated.map((candidate) => candidate.toolId));
    const sameCategory = tools.filter(
      (candidate) => candidate.toolId !== toolId && candidate.category === tool.category && !seen.has(candidate.toolId),
    );

    return [...curated, ...sameCategory].slice(0, RELATED_LIMIT);
  },
);
