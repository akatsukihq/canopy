import config from "@/lib/config/config.ts";
import { getSitemapTools } from "@/lib/tool-framework/catalog";
import { getBlogSitemapEntries } from "@/lib/blog/queries";
import type { MetadataRoute } from "next";
import { locales, localizeHref } from "@/lib/i18n/config";

// Deliberately no `generateStaticParams` companion anywhere: slugs and
// enablement live in `managed_tools`, so use the runtime public catalog cache
// instead of freezing the tool list until the next deployment.
//
// `force-dynamic` is what actually enforces that. Next prerenders `sitemap.ts`
// at build time by default, which both froze the tool list into the bundle and
// made `next build` require a reachable, migrated database — a deployment
// coupling we do not want.
export const dynamic = "force-dynamic";

const LOCALIZED_PAGES = [
  { path: "/", priority: 1 },
  { path: "/devtools", priority: 0.9 },
  { path: "/media", priority: 0.9 },
  { path: "/paperwork", priority: 0.9 },
  { path: "/paperwork/about", priority: 0.3 },
  { path: "/paperwork/terms", priority: 0.2 },
  { path: "/privacy", priority: 0.2 },
  { path: "/contact", priority: 0.3 },
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config.appUrl;

  // A sitemap is not worth a 500. If the catalog cannot be read, serve the
  // known-good static entries rather than failing the whole route.
  // Both reads are independent; run them together. The blog read needs the tool
  // count only to size its limit, so it is trimmed afterwards.
  const [tools, allPosts] = await Promise.all([
    getSitemapTools().catch(() => []),
    // A blog migration or read failure must not remove the existing tool URLs.
    getBlogSitemapEntries(50000).catch(() => []),
  ]);

  // Every public locale serves these pages; the blog index canonicalizes to one URL.
  const pages: MetadataRoute.Sitemap = [
    ...LOCALIZED_PAGES.flatMap(({ path, priority }) =>
      locales.map((locale) => ({
        url: new URL(localizeHref(path, locale), base).toString(),
        alternates: {
          languages: Object.fromEntries(
            locales.map((language) => [language, new URL(localizeHref(path, language), base).toString()]),
          ),
        },
        changeFrequency: "weekly" as const,
        priority,
      })),
    ),
    { url: new URL("/blog", base).toString(), changeFrequency: "daily" as const, priority: 0.6 },
  ];

  // ponytail: one sitemap holds 50,000 URLs; split into sitemap files before
  // reaching this total. Keep the established tool URLs ahead of blog entries.
  const entries: MetadataRoute.Sitemap = pages;
  entries.push(
    ...tools.flatMap((tool) =>
      tool.availableLocales.map((locale) => ({
        url: new URL(localizeHref(tool.href, locale), base).toString(),
        alternates: {
          languages: Object.fromEntries(
            tool.availableLocales.map((language) => [
              language,
              new URL(localizeHref(tool.href, language), base).toString(),
            ]),
          ),
        },
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    ),
  );
  entries.splice(50000);
  entries.push(
    ...allPosts.slice(0, 50000 - entries.length).map((post) => ({
      url: new URL(`/blog/${post.slug}`, base).toString(),
      lastModified: post.publishedUpdatedAt ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  );
  return entries;
}
