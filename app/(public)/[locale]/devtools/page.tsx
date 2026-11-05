import { FamilyToolSearch } from "@/components/ui/components/GlobalToolSearch";
import { getLocale, getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { isLocale, defaultLocale, localizeHref } from "@/lib/i18n/config";
import { CatalogHero } from "@/components/canopy/CatalogHero";
import { CatalogListing } from "@/components/canopy/CatalogListing";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { ToolIcon } from "@/components/ToolIcon";
import {
  categoriesForApp,
  FEATURED_TOOL_IDS,
  resolveCategoryKey,
  TOOL_CATEGORIES,
} from "@/lib/tool-framework/categories";
import { getToolListings, type CatalogToolListing } from "@/lib/tool-framework/catalog";
import { searchTools } from "@/lib/tool-catalog/index";
import { getOptionalSession } from "@/lib/auth/session.ts";
import {
  Caption,
  H2,
  Lead,
  Muted,
  Overline,
  Strong,
  Text,
  TextLink,
  AccountNavigation,
  AppContainer,
  BackButton,
  Button,
  CatalogCard,
  EmptyState,
  IconTile,
  Input,
  ProductHeader,
  SectionHeading,
  buttonVariants,
} from "@/components/ui/index.tsx";
import { ArrowRight, ArrowUpRight, LayoutGrid, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import { CategoryFilter } from "@/app/devtools/components/CategoryFilter";

const SECTION_HEADING_CLASS = "mb-8 items-end";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function ToolCard({ tool }: { tool: CatalogToolListing }) {
  const t = useTranslations("CatalogPage");
  return (
    <CatalogCard
      action={
        <>
          {t("openTool")}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </>
      }
      className="min-h-48 rounded-[1.25rem] p-5 shadow-none duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5"
      description={tool.description}
      href={tool.href}
      icon={<ToolIcon icon={tool.icon} />}
      title={tool.name}
    />
  );
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
  const requestHeaders = await headers();
  const params = await searchParams;
  const query = first(params.q).trim().slice(0, 80);
  const requestedCategory = first(params.category).slice(0, 80);
  const [tools, session] = await Promise.all([getToolListings("devtools", locale), getOptionalSession(requestHeaders)]);
  const category = resolveCategoryKey(requestedCategory, "devtools");
  const filteredTools = searchTools(
    tools.filter((tool) => !category || tool.category === category),
    query,
  );
  // Featured ordering is per-deployment data, not code. Until it has a home
  // beside `sort_order`, `FEATURED_TOOL_IDS` is empty and these sections
  // simply do not render.
  const featuredTools = FEATURED_TOOL_IDS.flatMap((toolId) => tools.filter((tool) => tool.toolId === toolId));
  const availableCategories = categoriesForApp("devtools")
    .map((key) => ({
      count: tools.filter((tool) => tool.category === key).length,
      description: categories(`${key}-description`),
      key,
      label: categories(key),
    }))
    .filter(({ count }) => count > 0);
  const hasFilter = Boolean(query || category);
  const showAllTools = !hasFilter && (first(params.view) === "all" || featuredTools.length === 0);
  const categoryLabel = category ? categories(category) : "";
  const searchForm = (
    <FamilyToolSearch family="devtools" initialQuery={query}>
      <form
        className="flex w-full items-center gap-2 rounded-2xl border border-input bg-card p-1.5 shadow-sm transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"
        method="get"
        role="search"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 start-4 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t("searchDeveloper")}
            className="h-12 border-0 bg-transparent ps-11 shadow-none"
            defaultValue={query}
            name="q"
            placeholder={t("developerPlaceholder")}
            type="search"
          />
        </div>
        <Button className="h-12 rounded-xl px-5" type="submit">
          {t("search")}
        </Button>
      </form>
    </FamilyToolSearch>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProductHeader
        account={{ returnTo: "/devtools", user: session?.user ?? null }}
        actions={<AccountNavigation returnTo="/devtools" user={session?.user ?? null} />}
        className="sticky top-0 z-50 bg-card/90 supports-[backdrop-filter]:bg-card/85 supports-[backdrop-filter]:backdrop-blur-xl"
        href={localizeHref("/devtools", locale)}
        name="Devtools"
      />

      <main>
        <CatalogHero suite="devtools" />
        {hasFilter || showAllTools ? (
          <section className="border-b border-border bg-muted/50">
            <AppContainer className="py-6">
              <div className="mx-auto max-w-2xl">{searchForm}</div>
            </AppContainer>
          </section>
        ) : (
          <section className="overflow-hidden border-b border-border bg-muted/50">
            <AppContainer className="py-6">
              <div className="mx-auto max-w-2xl">{searchForm}</div>

              <nav
                aria-label={t("popularTools")}
                className="mt-12 overflow-hidden rounded-2xl border border-border bg-border lg:mt-16"
              >
                <div className="flex min-h-12 items-center justify-between gap-4 bg-background px-4">
                  <Overline className="block text-muted-foreground">{t("popularNow")}</Overline>
                  <TextLink
                    className="inline-flex min-h-11 items-center gap-1.5 text-primary outline-none hover:underline focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    href={localizeHref("/devtools?view=all", locale)}
                  >
                    {common("allTools")}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </TextLink>
                </div>
                <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {featuredTools.slice(0, 6).map((tool, index) => (
                    <TextLink
                      className="no-underline group flex min-h-24 flex-col justify-between bg-card p-4 text-card-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      href={tool.href}
                      key={tool.toolId}
                    >
                      <Caption className="text-muted-foreground group-hover:text-accent-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </Caption>
                      <Text className="flex items-end justify-between gap-3">
                        {tool.name}
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-primary group-hover:text-accent-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        />
                      </Text>
                    </TextLink>
                  ))}
                </div>
              </nav>
            </AppContainer>
          </section>
        )}

        {hasFilter || showAllTools ? (
          <CatalogListing category={category} className="pt-6 pb-12 sm:pb-16" query={query}>
            <AppContainer>
              <SectionHeading
                back={
                  hasFilter ? (
                    <BackButton
                      href={localizeHref(category && !query ? "/devtools?view=all" : "/devtools", locale)}
                      label={category && !query ? common("allTools") : t("clearFilters")}
                    />
                  ) : undefined
                }
                action={
                  showAllTools || category ? (
                    <CategoryFilter
                      categories={availableCategories.map(({ key, label }) => ({
                        label,
                        value: key,
                      }))}
                      value={category}
                    />
                  ) : null
                }
                className="mb-6 flex-col items-stretch sm:flex-row sm:items-center"
                description={
                  showAllTools && !category && !query
                    ? t("allDeveloper")
                    : query
                      ? t(categoryLabel ? "matchingCategory" : "matching", { query, category: categoryLabel })
                      : t("categoryTools", { category: categoryLabel })
                }
                title={
                  showAllTools && !category && !query
                    ? common("allTools")
                    : category && !query
                      ? categoryLabel
                      : t("searchResults")
                }
              />
              {filteredTools.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTools.map((tool) => (
                    <ToolCard key={tool.toolId} tool={tool} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  action={
                    <a className={buttonVariants()} href={localizeHref("/devtools", locale)}>
                      {t(showAllTools ? "back" : "browseAll")}
                    </a>
                  }
                  description={showAllTools ? t("emptyDeveloper") : t("trySearch")}
                  title={t("noTools")}
                />
              )}
            </AppContainer>
          </CatalogListing>
        ) : (
          <>
            <section className="py-14 sm:py-20" id="popular-tools">
              <AppContainer>
                <SectionHeading
                  action={
                    <a
                      className={buttonVariants({
                        className: "h-11",
                        variant: "outline",
                      })}
                      href={localizeHref("/devtools?view=all", locale)}
                    >
                      {common("allTools")}
                    </a>
                  }
                  className={SECTION_HEADING_CLASS}
                  description={t("popularDescription")}
                  eyebrow={t("startHere")}
                  title={t("popularTools")}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featuredTools.map((tool) => (
                    <ToolCard key={tool.toolId} tool={tool} />
                  ))}
                </div>
              </AppContainer>
            </section>

            <section className="border-y border-border bg-card py-14 sm:py-20">
              <AppContainer>
                <SectionHeading
                  className={SECTION_HEADING_CLASS}
                  description={t("categoryDescription")}
                  eyebrow={t("toolIndex")}
                  title={t("categoryTitle")}
                />
                <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                  {availableCategories.map(({ count, description, key, label }) => (
                    <TextLink
                      className="no-underline group flex min-h-28 items-start gap-4 bg-card p-5 text-card-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:last:col-span-2"
                      href={localizeHref(`/devtools?category=${encodeURIComponent(key)}`, locale)}
                      key={key}
                    >
                      <IconTile className="rounded-xl group-hover:bg-background" size="sm">
                        <LayoutGrid aria-hidden="true" className="size-5" />
                      </IconTile>
                      <span className="min-w-0 flex-1">
                        <Strong className="block">{label}</Strong>
                        <Text className="mt-1 block text-muted-foreground group-hover:text-accent-foreground">
                          {description}
                        </Text>
                        <Caption className="mt-2 block text-primary group-hover:text-accent-foreground">
                          {common("toolCount", { count })}
                        </Caption>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-foreground"
                      />
                    </TextLink>
                  ))}
                </div>
              </AppContainer>
            </section>

            <section className="py-14 sm:py-20">
              <AppContainer>
                <div className="flex flex-col gap-8 overflow-hidden rounded-[1.75rem] bg-card-foreground px-6 py-8 text-card sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex max-w-3xl items-start gap-5">
                    <IconTile className="size-12 rounded-2xl bg-primary text-primary-foreground">
                      <LockKeyhole aria-hidden="true" className="size-6" />
                    </IconTile>
                    <div>
                      <Overline className="block text-primary">{t("privateDefault")}</Overline>
                      <H2 className="mt-2">{t("privateTitle")}</H2>
                      <Lead className="mt-3 max-w-2xl text-card/70">{t("privateDescription")}</Lead>
                    </div>
                  </div>
                  <a className={buttonVariants({ size: "lg" })} href={localizeHref("/devtools?view=all", locale)}>
                    {common("viewAllTools", { count: tools.length })}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
              </AppContainer>
            </section>
          </>
        )}
      </main>

      <CanopyFooter />
    </div>
  );
}
