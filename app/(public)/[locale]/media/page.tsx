import { FamilyToolSearch } from "@/components/ui/components/GlobalToolSearch";
import { getLocale, getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { isLocale, defaultLocale, localizeHref, localizedAlternates } from "@/lib/i18n/config";
import { JsonLd } from "@/components/seo/JsonLd";
import { suiteStructuredData } from "@/lib/seo/structuredData";
import type { Metadata } from "next";
import { CatalogHero } from "@/components/canopy/CatalogHero";
import { CatalogListing } from "@/components/canopy/CatalogListing";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { ToolIcon } from "@/components/ToolIcon";
import { getToolListings, type CatalogToolListing } from "@/lib/tool-framework/catalog";
import { searchTools } from "@/lib/tool-catalog/index";
import { categoriesForApp, resolveCategoryKey, TOOL_CATEGORIES } from "@/lib/tool-framework/categories";
import { getOptionalSession } from "@/lib/auth/session.ts";
import {
  Caption,
  H2,
  Metric,
  Muted,
  Strong,
  TextLink,
  AccountNavigation,
  AppContainer,
  Button,
  Card,
  CatalogCard,
  EmptyState,
  IconTile,
  Input,
  ProductHeader,
  SectionHeading,
  StatusBadge,
  buttonVariants,
} from "@/components/ui/index.tsx";
import { LayoutGrid, LockKeyhole, Search, ShieldCheck, Zap } from "lucide-react";
import { headers } from "next/headers";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function ToolCard({ tool }: { tool: CatalogToolListing }) {
  const t = useTranslations("CatalogPage");
  return (
    <CatalogCard
      action={<>{t("openTool")} →</>}
      description={tool.description}
      href={tool.href}
      icon={<ToolIcon icon={tool.icon} />}
      status={<StatusBadge variant="success">{t("browserOnly")}</StatusBadge>}
      title={tool.name}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const requestedLocale = await getLocale();
  return { alternates: localizedAlternates("/media", isLocale(requestedLocale) ? requestedLocale : defaultLocale) };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [requestedLocale, t, common, categories] = await Promise.all([
    getLocale(),
    getTranslations("CatalogPage"),
    getTranslations("Common"),
    getTranslations("Categories"),
  ]);
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const catalog = await getTranslations("Catalog");
  const requestHeaders = await headers();
  const params = await searchParams;
  const query = first(params.q).trim().slice(0, 80);
  const requestedCategory = first(params.category).slice(0, 80);
  const category = resolveCategoryKey(requestedCategory, "media");
  const [tools, session] = await Promise.all([getToolListings("media", locale), getOptionalSession(requestHeaders)]);
  const categoryLabel = category ? categories(category) : "";
  const filteredTools = searchTools(
    tools.filter((tool) => !category || tool.category === category),
    query,
  );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProductHeader
        account={{ returnTo: "/media", user: session?.user ?? null }}
        actions={<AccountNavigation returnTo="/media" user={session?.user ?? null} />}
        href={localizeHref("/media", locale)}
        name="Media Tools"
      />

      <main>
        <JsonLd
          data={suiteStructuredData({
            suite: "media",
            name: catalog("mediaOverline"),
            description: catalog("mediaMetadataDescription"),
            locale,
            tools: tools.map((tool) => ({ name: tool.name, href: tool.href })),
          })}
        />
        <CatalogHero suite="media" />
        <section aria-label={t("findMedia")} className="bg-muted/50">
          <AppContainer className="py-6">
            <FamilyToolSearch family="media" initialQuery={query}>
              <form
                className="mx-auto flex w-full max-w-2xl gap-2 rounded-2xl bg-card p-2 shadow-lg"
                method="get"
                role="search"
              >
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 start-3 size-5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label={t("searchMedia")}
                    className="border-0 ps-10 shadow-none focus-visible:ring-0"
                    defaultValue={query}
                    name="q"
                    placeholder={t("mediaPlaceholder")}
                    type="search"
                  />
                </div>
                <Button type="submit" variant="default">
                  {t("search")}
                </Button>
              </form>
            </FamilyToolSearch>
          </AppContainer>
        </section>

        <section aria-label={t("mediaFacts")} className="border-b border-border bg-card">
          <AppContainer className="grid grid-cols-2 divide-x divide-y divide-border py-6 sm:grid-cols-4 sm:divide-y-0">
            {[
              [`${tools.length}`, t("enabledTools")],
              ["100%", t("onDevice")],
              ["1", t("workerRunner")],
              ["0", t("fileUploads")],
            ].map(([value, label]) => (
              <div className="px-4 py-3 text-center" key={label}>
                <Metric className="block text-primary">{value}</Metric>
                <Caption className="mt-1 block text-muted-foreground">{label}</Caption>
              </div>
            ))}
          </AppContainer>
        </section>

        <CatalogListing category={category} className="pt-6 pb-14 sm:pb-16" query={query}>
          <AppContainer>
            <SectionHeading
              action={
                query || category ? (
                  <a
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={localizeHref("/media", locale)}
                  >
                    {t("clearFilters")}
                  </a>
                ) : undefined
              }
              description={
                query
                  ? t(categoryLabel ? "matchingCategory" : "matching", { query, category: categoryLabel })
                  : category
                    ? t("categoryTools", { category: categoryLabel })
                    : t("mediaDescription")
              }
              title={t(query || category ? "searchResults" : "allMedia")}
            />
            {filteredTools.length ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTools.map((tool) => (
                  <ToolCard key={tool.toolId} tool={tool} />
                ))}
              </div>
            ) : (
              <EmptyState
                action={
                  <a className={buttonVariants()} href={localizeHref("/media", locale)}>
                    {t("browseAll")}
                  </a>
                }
                description={t("trySearch")}
                title={t("noTools")}
              />
            )}
          </AppContainer>
        </CatalogListing>

        <section className="border-y border-border bg-muted/50 py-14 sm:py-16">
          <AppContainer>
            <SectionHeading description={t("mediaCategoryDescription")} title={t("categoryTitle")} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categoriesForApp("media").map((key) => {
                const count = tools.filter((tool) => tool.category === key).length;
                return (
                  <TextLink
                    className="no-underline text-foreground group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm outline-none transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    href={localizeHref(`/media?category=${encodeURIComponent(key)}`, locale)}
                    key={key}
                  >
                    <IconTile className="rounded-xl" size="sm">
                      <LayoutGrid aria-hidden="true" className="size-5" />
                    </IconTile>
                    <span className="min-w-0">
                      <Strong className="block group-hover:text-primary">{categories(key)}</Strong>
                      <Caption className="mt-1 block text-muted-foreground">{categories(`${key}-description`)}</Caption>
                      <Caption className="mt-2 block text-primary">{common("toolCount", { count })}</Caption>
                    </span>
                  </TextLink>
                );
              })}
            </div>
          </AppContainer>
        </section>

        <section className="py-14 sm:py-16">
          <AppContainer className="grid gap-6 lg:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: t("localTitle"),
                description: t("localDescription"),
              },
              {
                icon: Zap,
                title: t("responsiveTitle"),
                description: t("responsiveDescription"),
              },
              {
                icon: LockKeyhole,
                title: t("storageTitle"),
                description: t("storageDescription"),
              },
            ].map(({ description, icon: Icon, title }) => (
              <Card className="gap-0 rounded-2xl shadow-none" key={title} role="article">
                <Icon aria-hidden="true" className="size-6 text-primary" />
                <H2 className="mt-4">{title}</H2>
                <Muted className="mt-2 text-muted-foreground">{description}</Muted>
              </Card>
            ))}
          </AppContainer>
        </section>
      </main>

      <CanopyFooter />
    </div>
  );
}
