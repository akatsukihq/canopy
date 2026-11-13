import config from "@/lib/config/config.ts";
import { getSitemapTools } from "@/lib/tool-framework/catalog";
import { getBlogSitemapEntries } from "@/lib/blog/queries";
import type { MetadataRoute } from "next";
import { defaultLocale, locales, localizeHref, type Locale } from "@/lib/i18n/config";

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
  "/",
  "/devtools",
  "/media",
  "/paperwork",
  "/paperwork/about",
  "/paperwork/terms",
  "/privacy",
  "/contact",
] as const;

// Google ignores <changefreq> and <priority>, and only trusts <lastmod> when it is accurate, so entries carry a
// <lastmod> only where a real modification date exists. `x-default` points at the English URL, which every page has.
function localizedEntry(
  path: string,
  locale: Locale,
  availableLocales: readonly Locale[],
  base: string,
  lastModified?: Date,
): MetadataRoute.Sitemap[number] {
  const urlFor = (language: Locale) => new URL(localizeHref(path, language), base).toString();
  return {
    url: urlFor(locale),
    ...(lastModified ? { lastModified } : {}),
    alternates: {
      languages: {
        "x-default": urlFor(defaultLocale),
        ...Object.fromEntries(availableLocales.map((language) => [language, urlFor(language)])),
      },
    },
  };
}

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
    ...LOCALIZED_PAGES.flatMap((path) => locales.map((locale) => localizedEntry(path, locale, locales, base))),
    { url: new URL("/blog", base).toString() },
  ];

  // ponytail: one sitemap holds 50,000 URLs; split into sitemap files before
  // reaching this total. Keep the established tool URLs ahead of blog entries.
  const entries: MetadataRoute.Sitemap = pages;
  entries.push(
    ...tools.flatMap((tool) =>
      tool.availableLocales.map((locale) =>
        localizedEntry(tool.href, locale, tool.availableLocales, base, tool.updatedAt),
      ),
    ),
  );
  entries.splice(50000);
  entries.push(
    ...allPosts.slice(0, 50000 - entries.length).map((post) => ({
      url: new URL(`/blog/${post.slug}`, base).toString(),
      lastModified: post.publishedUpdatedAt ?? undefined,
    })),
  );
  return entries;
}
