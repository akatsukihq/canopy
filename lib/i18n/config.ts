export const locales = ["en", "hi", "es", "fr", "de", "pt-BR", "ar", "zh-Hans", "ja", "ru"] as const;

export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.some((locale) => locale === value);
}

export function direction(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export const localeLabels: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  ar: "العربية",
  "zh-Hans": "简体中文",
  ja: "日本語",
  ru: "Русский",
};

export function unlocalizedPathname(pathname: string): string {
  const segment = pathname.split("/")[1];
  return isLocale(segment) ? pathname.slice(segment.length + 1) || "/" : pathname;
}

/** Public page scopes only: APIs, account flows, subdomains and assets keep their URLs. */
export function isPublicPagePath(pathname: string): boolean {
  const path = unlocalizedPathname(pathname);
  if (/^\/media\/(?:vendor|licenses)(?:\/|$)/.test(path) || path === "/blog/feed.xml") return false;
  return (
    path === "/" ||
    /^\/(?:devtools|media|paperwork|blog)(?:\/|$)/.test(path) ||
    /^\/(?:privacy|contact|offline)\/?$/.test(path)
  );
}

/** Locale-aware plain anchors retain their search/hash and never rewrite external URLs. */
export function localizeHref(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex < 0 ? href : href.slice(0, suffixIndex);
  if (!isPublicPagePath(pathname)) return href;
  const path = unlocalizedPathname(pathname);
  const suffix = suffixIndex < 0 ? "" : href.slice(suffixIndex);
  return `${locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`}${suffix}`;
}

/** Canonical plus hreflang alternates (and x-default) for a page served in every locale. */
export function localizedAlternates(
  path: string,
  locale: Locale,
): { canonical: string; languages: Record<string, string> } {
  return {
    canonical: localizeHref(path, locale),
    languages: {
      ...Object.fromEntries(locales.map((language) => [language, localizeHref(path, language)])),
      "x-default": localizeHref(path, defaultLocale),
    },
  };
}
