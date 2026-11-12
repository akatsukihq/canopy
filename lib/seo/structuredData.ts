/**
 * Schema.org JSON-LD for public pages. Every page links to one Organization by
 * `@id`, so search and AI engines resolve "SmartTools" to this site rather than
 * the many unrelated products with the same name.
 */

import config from "../config/config.ts";
import { localizeHref, type Locale } from "../i18n/config.ts";

const SITE_NAME = "SmartTools";

type Suite = "devtools" | "media" | "paperwork";

const APPLICATION_CATEGORY: Record<Suite, string> = {
  devtools: "DeveloperApplication",
  media: "MultimediaApplication",
  paperwork: "BusinessApplication",
};

/** Script-safe JSON, including when stored text contains literal closing script tags. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function absolute(path: string, appUrl: string): string {
  return new URL(path, appUrl).href;
}

export function organizationId(appUrl = config.appUrl): string {
  return absolute("/#organization", appUrl);
}

/** The publisher reference every other node points at. */
export function organizationReference(appUrl = config.appUrl) {
  return {
    "@type": "Organization",
    "@id": organizationId(appUrl),
    name: SITE_NAME,
    url: absolute("/", appUrl),
    logo: absolute("/logo.svg", appUrl),
  };
}

/** Homepage graph: the Organization and WebSite entities. */
export function siteStructuredData({
  description,
  locale,
  appUrl = config.appUrl,
}: {
  description: string;
  locale: Locale;
  appUrl?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...organizationReference(appUrl), description },
      {
        "@type": "WebSite",
        "@id": absolute("/#website", appUrl),
        name: SITE_NAME,
        url: absolute(localizeHref("/", locale), appUrl),
        description,
        inLanguage: locale,
        publisher: { "@id": organizationId(appUrl) },
      },
    ],
  };
}

type Crumb = { name: string; href?: string };

function breadcrumbs(items: readonly Crumb[], appUrl: string) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.href ? { item: absolute(item.href, appUrl) } : {}),
    })),
  };
}

/** A single free, browser-based tool page. `href` is already localized. */
export function toolStructuredData({
  suite,
  suiteName,
  name,
  description,
  href,
  locale,
  appUrl = config.appUrl,
}: {
  suite: Suite;
  suiteName: string;
  name: string;
  description: string;
  href: string;
  locale: Locale;
  appUrl?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name,
        description,
        url: absolute(href, appUrl),
        applicationCategory: APPLICATION_CATEGORY[suite],
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        inLanguage: locale,
        publisher: { "@id": organizationId(appUrl) },
      },
      breadcrumbs(
        [
          { name: SITE_NAME, href: localizeHref("/", locale) },
          { name: suiteName, href: localizeHref(`/${suite}`, locale) },
          { name },
        ],
        appUrl,
      ),
    ],
  };
}

/** A suite hub listing its tools. Tool `href`s are already localized. */
export function suiteStructuredData({
  suite,
  name,
  description,
  locale,
  tools,
  appUrl = config.appUrl,
}: {
  suite: Suite;
  name: string;
  description: string;
  locale: Locale;
  tools: readonly { name: string; href: string }[];
  appUrl?: string;
}) {
  const url = absolute(localizeHref(`/${suite}`, locale), appUrl);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name,
        description,
        url,
        inLanguage: locale,
        isPartOf: { "@id": absolute("/#website", appUrl) },
        publisher: { "@id": organizationId(appUrl) },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: tools.length,
          itemListElement: tools.map((tool, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: tool.name,
            url: absolute(tool.href, appUrl),
          })),
        },
      },
      breadcrumbs([{ name: SITE_NAME, href: localizeHref("/", locale) }, { name }], appUrl),
    ],
  };
}
