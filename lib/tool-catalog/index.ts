/**
 * Pure tool-catalogue logic. Data-free by design.
 *
 * This package holds no inventory: no tool list, no seed rows, no names. It
 * cannot have one — `AGENTS.md` forbids a package importing the application,
 * and the real source of truth (`managed_tools` rows, plus `tools/<key>/`)
 * lives there. So the manifest is always supplied by the caller, and every
 * function here is a pure transformation over it.
 *
 * The application-side manifest provider is `lib/tool-framework/manifest.ts`.
 */

import { isCategoryKey, TOOL_CATEGORIES } from "../tool-framework/categories.ts";

export type ToolApp = "paperwork" | "devtools" | "media";

/** One tool as the application knows it, before database overrides. */
export interface ToolManifestEntry {
  id: string;
  app: ToolApp;
  /** Human-readable grouping label. Absent when the tool ships no definition. */
  category?: string;
  /** The folder under `tools/`, and the second half of the tool id. */
  componentKey: string;
  defaultName: string;
  defaultDescription: string;
  keywords?: readonly string[];
}

/** The administrator-owned half of a tool. */
export interface ManagedTool {
  toolId: string;
  /** Raw `icon` column (untrusted); `resolveIcon` parses it as a `MediaRef`. */
  icon: unknown;
  slug: string | null;
  name: string;
  description: string;
  order: number;
  enabled: boolean;
  archived: boolean;
}

export interface ResolvedTool extends ToolManifestEntry, ManagedTool {}

export const reservedToolSlugs = {
  paperwork: ["admin", "api"],
  devtools: ["api"],
  media: ["api"],
} as const satisfies Readonly<Record<ToolApp, readonly string[]>>;

export const TOOL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!TOOL_SLUG_PATTERN.test(slug)) {
    throw new Error("Tool name must contain at least one letter or number.");
  }
  return slug;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidToolSlug(app: ToolApp, slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    TOOL_SLUG_PATTERN.test(slug) &&
    !reservedToolSlugs[app].some((reservedSlug) => reservedSlug === slug)
  );
}

/**
 * Folds one stored row over one manifest entry.
 *
 * An unreadable or invalid slug resolves to `null`, and a tool with no route
 * can never be enabled — that is the fail-closed edge the whole merge exists
 * to enforce.
 */
export function mergeManagedTool(manifest: ToolManifestEntry, fallback: ManagedTool, stored: unknown): ManagedTool {
  if (!isRecord(stored)) return fallback;

  const slug = Object.hasOwn(stored, "slug")
    ? stored.slug === null
      ? null
      : isValidToolSlug(manifest.app, stored.slug)
        ? stored.slug
        : null
    : fallback.slug;

  return {
    toolId: manifest.id,
    icon: stored.icon ?? null,
    slug,
    name: typeof stored.name === "string" && stored.name.trim() ? stored.name.trim() : fallback.name,
    description:
      typeof stored.description === "string" && stored.description.trim()
        ? stored.description.trim()
        : fallback.description,
    order: Number.isInteger(stored.order) ? (stored.order as number) : fallback.order,
    enabled: slug !== null && (typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled),
    archived: typeof stored.archived === "boolean" ? stored.archived : fallback.archived,
  };
}

/**
 * Resolves the manifest against stored rows.
 *
 * The manifest is the map: a stored row whose `toolId` is in no entry is
 * dropped silently, and a manifest entry with no stored row falls back to
 * setup-required and disabled. Both are deliberate — a row for code that no
 * longer ships must not resurrect a route, and a tool nobody has configured
 * must not go live on a guessed slug.
 */
export function mergeToolManifest(managedTools: unknown, manifest: readonly ToolManifestEntry[]): ResolvedTool[] {
  const storedById = new Map<string, unknown>();

  if (Array.isArray(managedTools)) {
    for (const stored of managedTools) {
      if (isRecord(stored) && typeof stored.toolId === "string" && !storedById.has(stored.toolId)) {
        storedById.set(stored.toolId, stored);
      }
    }
  }

  const nextOrder: Record<ToolApp, number> = {
    paperwork: 0,
    devtools: 0,
    media: 0,
  };

  return manifest.map((entry) => {
    const fallback: ManagedTool = {
      toolId: entry.id,
      icon: null,
      slug: null,
      name: entry.defaultName,
      description: entry.defaultDescription,
      order: nextOrder[entry.app]++,
      enabled: false,
      archived: false,
    };

    return {
      ...entry,
      ...mergeManagedTool(entry, fallback, storedById.get(entry.id)),
    };
  });
}

export function areToolSlugsUnique(tools: readonly ManagedTool[], manifest: readonly ToolManifestEntry[]): boolean {
  const appById = new Map(manifest.map((entry) => [entry.id, entry.app] as const));
  const slugs = new Set<string>();

  for (const tool of tools) {
    if (tool.slug === null) continue;

    const app = appById.get(tool.toolId);
    if (!app) return false;

    const key = `${app}:${tool.slug}`;
    if (slugs.has(key)) return false;
    slugs.add(key);
  }

  return true;
}

export function assertToolSlugImmutable(previousSlug: string | null, nextSlug: string | null): void {
  if (previousSlug !== null && previousSlug !== nextSlug) {
    throw new Error("A saved tool slug is immutable.");
  }
}

export function isToolAvailable<T extends ManagedTool>(tool: T): tool is T & { slug: string } {
  return tool.slug !== null && tool.enabled && !tool.archived;
}

export function getEnabledTools<T extends ResolvedTool>(
  tools: readonly T[],
  app?: ToolApp,
): Array<T & { slug: string }> {
  return tools
    .filter((tool): tool is T & { slug: string } => isToolAvailable(tool) && (!app || tool.app === app))
    .sort((left, right) => left.order - right.order);
}

export function searchTools<
  T extends { name: string; description: string; keywords: readonly string[]; category: string },
>(tools: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...tools];

  // Six relevance tiers, each holding any number of matches; results are never truncated.
  const matchesByRelevance: T[][] = Array.from({ length: 6 }, () => []);

  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const category = isCategoryKey(tool.category) ? TOOL_CATEGORIES[tool.category].label : tool.category;
    let rank: number;

    if (name === normalizedQuery) rank = 0;
    else if (name.startsWith(normalizedQuery)) rank = 1;
    else if (name.includes(normalizedQuery)) rank = 2;
    else if (tool.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery))) rank = 3;
    else if (tool.description.toLowerCase().includes(normalizedQuery)) rank = 4;
    else if (category.toLowerCase().includes(normalizedQuery)) rank = 5;
    else continue;

    matchesByRelevance[rank].push(tool);
  }

  return matchesByRelevance.flat();
}

export function findAvailableToolBySlug<T extends ResolvedTool>(
  tools: readonly T[],
  app: ToolApp,
  slug: unknown,
): (T & { slug: string }) | undefined {
  if (!isValidToolSlug(app, slug)) return undefined;

  const matches = tools.filter(
    (tool): tool is T & { slug: string } => tool.app === app && tool.slug === slug && isToolAvailable(tool),
  );

  // An ambiguous slug resolves to nothing rather than an arbitrary winner.
  return matches.length === 1 ? matches[0] : undefined;
}
