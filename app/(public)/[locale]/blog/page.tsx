import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { localizeHref, type Locale } from "@/lib/i18n/config";
import { ZodError } from "zod";
import { ArrowRight, BookOpen, ChevronDown, Search } from "lucide-react";
import {
  Button,
  Card,
  Caption,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  H1,
  H2,
  Input,
  Label,
  Overline,
  P,
  TextLink,
} from "@/components/ui/index.tsx";
import { BlogValidationError } from "@/lib/blog/document";
import { blogImageDelivery } from "@/lib/blog/utils";
import { listPublishedBlogPosts, listPublishedBlogTaxonomy } from "@/lib/blog/queries";
import { BlogByline } from "@/app/blog/components/BlogTeaser";
import { BlogStories } from "@/app/blog/components/BlogStories";
import { BlogPageContainer } from "@/components/blog/BlogPageContainer";
import { blogListingHref, parseBlogFilters, type BlogFilters } from "@/app/blog/lib/filters";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [params, t] = await Promise.all([searchParams, getTranslations("Blog")]);
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "/blog", types: { "application/rss+xml": "/blog/feed.xml" } },
    ...(Object.values(params).some(Boolean) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const [t, requestedLocale] = await Promise.all([getTranslations("Blog"), getLocale()]);
  const locale = requestedLocale as Locale;
  const href = (path: string) => localizeHref(path, locale);
  const listingHref = (filters: BlogFilters, changes?: Partial<BlogFilters>) => href(blogListingHref(filters, changes));
  let filters: BlogFilters;
  try {
    filters = parseBlogFilters(await searchParams);
  } catch (error) {
    if (error instanceof ZodError) notFound();
    throw error;
  }
  const { categoryCursor, ...postFilters } = filters;
  const [posts, categories] = await Promise.all([
    listPublishedBlogPosts(postFilters),
    listPublishedBlogTaxonomy("category", { cursor: categoryCursor }),
  ]).catch((error) => {
    if (error instanceof BlogValidationError || error instanceof ZodError) notFound();
    throw error;
  });
  const filtered = Boolean(filters.search || filters.category || filters.tag);
  const featured = !filtered && !filters.cursor ? posts.items[0] : undefined;
  const activeCategory =
    categories.items.find((category) => category.slug === filters.category)?.name ??
    posts.items[0]?.category.label ??
    filters.category;
  const StoriesHeading = filters.search ? H1 : H2;
  const topicDescriptions: Record<string, string> = {
    business: t("businessDescription"),
    technology: t("technologyDescription"),
    design: t("designDescription"),
  };

  return (
    <BlogPageContainer
      className={`flex flex-col gap-7 py-8 lg:gap-8 ${filters.search ? "lg:py-12" : "lg:pt-10 lg:pb-12"}`}
    >
      {!filters.search && (
        <header className="order-0 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center lg:gap-14">
          <div className="space-y-2">
            <Overline className="font-sans text-xs font-normal leading-normal tracking-normal text-accent-text">
              {t("brandHeading")}
            </Overline>
            <H1 className="font-sans text-[38px] font-semibold leading-[1.12] tracking-tight sm:text-[44px]">
              {t("heading")}
            </H1>
          </div>
          <div className="space-y-2">
            <P className="text-[19px] leading-normal lg:text-[17px]">{t("description")}</P>
            <P className="text-sm text-muted-foreground">
              <span className="lg:hidden">{t("shortDescription")}</span>
              <span className="hidden lg:inline">{t("longDescription")}</span>
            </P>
          </div>
        </header>
      )}

      <section
        aria-label={t("findArticles")}
        className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 lg:flex-row lg:items-end lg:gap-8"
      >
        <nav
          aria-label={t("categories")}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1 border-b border-border"
        >
          <Button
            asChild
            variant="ghost"
            className={`rounded-none px-2 ${!filters.category ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            <a
              aria-current={!filters.category ? "page" : undefined}
              href={listingHref(filters, { category: undefined, cursor: undefined })}
            >
              {t("allStories")}
            </a>
          </Button>
          {categories.items.slice(0, 3).map((category) => (
            <Button
              asChild
              key={category.id}
              variant="ghost"
              className={`max-w-full rounded-none px-2 ${category.slug === filters.category ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
            >
              <a
                className="truncate"
                aria-current={category.slug === filters.category ? "page" : undefined}
                href={listingHref(filters, { category: category.slug, cursor: undefined })}
              >
                {category.name}
              </a>
            </Button>
          ))}
          {(categories.items.length > 3 || categories.nextCursor || categoryCursor) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost">
                  {t("moreTopics")} <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {categories.items.slice(3).map((category) => (
                  <DropdownMenuItem asChild key={category.id}>
                    <a href={listingHref(filters, { category: category.slug, cursor: undefined })}>{category.name}</a>
                  </DropdownMenuItem>
                ))}
                {categoryCursor && (
                  <DropdownMenuItem asChild>
                    <a href={listingHref(filters, { categoryCursor: undefined })}>{t("firstTopics")}</a>
                  </DropdownMenuItem>
                )}
                {categories.nextCursor && (
                  <DropdownMenuItem asChild>
                    <a href={listingHref(filters, { categoryCursor: categories.nextCursor })}>{t("moreTopics")} →</a>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>
        <form
          action={href("/blog")}
          method="get"
          role="search"
          className={`shrink-0 ${filters.search ? "lg:w-[300px]" : "lg:w-80"}`}
        >
          {filters.category && <input type="hidden" name="category" value={filters.category} />}
          {filters.tag && <input type="hidden" name="tag" value={filters.tag} />}
          <Label
            htmlFor="blog-search"
            className={`mb-2 block text-xs font-normal ${filters.search ? "" : "lg:sr-only"}`}
          >
            {t("searchBlog")}
          </Label>
          <div className="relative">
            <Input
              className="pe-12"
              id="blog-search"
              name="search"
              type="search"
              defaultValue={filters.search}
              maxLength={200}
              placeholder={t("searchPlaceholder")}
            />
            <Button
              className="absolute end-1 top-1 h-9 w-9"
              type="submit"
              size="icon"
              variant="ghost"
              aria-label={t("searchArticles")}
            >
              <Search aria-hidden="true" />
            </Button>
          </div>
        </form>
      </section>

      {featured && (
        <Card
          className={`order-1 gap-6 rounded-xl border-0 bg-muted p-5 shadow-none lg:order-2 lg:gap-10 lg:rounded-lg lg:p-6 ${featured.coverImage ? "lg:grid lg:grid-cols-[minmax(0,560fr)_minmax(0,632fr)] lg:items-center" : ""}`}
        >
          {featured.coverImage && (
            <img
              className="aspect-[62/41] w-full rounded-lg object-cover lg:aspect-auto lg:h-65"
              {...blogImageDelivery(featured.coverImage)}
              sizes="(min-width: 1440px) 560px, (min-width: 1024px) calc((100vw - 248px) * 0.4698), (min-width: 640px) calc(100vw - 104px), calc(100vw - 80px)"
              alt={featured.coverImage.alt}
              width={featured.coverImage.media.width}
              height={featured.coverImage.media.height}
              fetchPriority="high"
            />
          )}
          <div className="min-w-0 space-y-5 lg:space-y-4">
            <Overline className="font-sans text-xs font-normal leading-normal tracking-normal text-accent-text">
              {t("latestStory", { category: featured.category.label })}
            </Overline>
            <H2 className="break-words font-sans text-[30px] leading-[1.12] lg:text-[34px]">
              <TextLink className="text-foreground no-underline hover:underline" href={href(`/blog/${featured.slug}`)}>
                {featured.title}
              </TextLink>
            </H2>
            <P className="break-words text-[17px] leading-normal text-muted-foreground lg:text-base">
              {featured.excerpt}
            </P>
            <BlogByline post={featured} />
            <Button asChild>
              <a href={href(`/blog/${featured.slug}`)}>
                {t("readGuide")} <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
              </a>
            </Button>
          </div>
        </Card>
      )}

      <BlogStories
        key={blogListingHref(postFilters)}
        initialPage={posts}
        filters={postFilters}
        featuredId={featured?.id}
        searchCoverDelivery={
          filters.search && posts.items[0]?.coverImage ? blogImageDelivery(posts.items[0].coverImage) : undefined
        }
        intro={
          <>
            <div
              className={`flex flex-col gap-2 ${filters.search ? "mb-8" : "mb-7 lg:mb-0 lg:flex-row lg:items-center lg:justify-between lg:border-b lg:border-border lg:pb-4"}`}
            >
              <StoriesHeading
                id="blog-stories-heading"
                className={`break-words font-sans text-[28px] leading-normal ${filters.search ? "" : "font-normal lg:text-[26px] lg:font-semibold"}`}
              >
                {filters.search
                  ? t("resultsFor", { query: filters.search })
                  : filtered
                    ? t("filteredArticles")
                    : t("latestArticles")}
              </StoriesHeading>
              {!filters.search && (
                <Caption className="font-sans text-sm text-muted-foreground lg:text-[13px]">
                  <span className="lg:hidden">{t("goodAnswers")}</span>
                  <span className="hidden lg:inline">{t("newestFirst")}</span>
                </Caption>
              )}
            </div>
            {filtered && (
              <div className="my-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                {filters.category && <span>{t("topic", { topic: activeCategory ?? "" })}</span>}
                {filters.tag && <span>{t("tag", { tag: filters.tag })}</span>}
                {filters.search && (
                  <TextLink href={listingHref(filters, { search: undefined, cursor: undefined })}>
                    {t("clearSearch")}
                  </TextLink>
                )}
                <TextLink href={href("/blog")}>{t("resetFilters")}</TextLink>
              </div>
            )}
          </>
        }
        emptyState={
          <EmptyState
            className="my-6"
            icon={<BookOpen />}
            title={filters.search || filters.cursor ? t("noStories") : t("comingSoon")}
            description={
              filters.search
                ? t("noMatches", { query: filters.search })
                : filtered
                  ? t("noCategoryStories")
                  : filters.cursor
                    ? t("endOfStories")
                    : t("preparing")
            }
            action={
              <Button asChild>
                <a
                  href={
                    filters.search
                      ? listingHref(filters, { search: undefined, cursor: undefined })
                      : filtered || filters.cursor
                        ? href("/blog")
                        : href("/")
                  }
                >
                  {filters.search ? t("clearSearch") : filtered || filters.cursor ? t("browseAll") : t("exploreTools")}
                </a>
              </Button>
            }
          />
        }
        topics={
          !filters.search && categories.items.length > 0 ? (
            <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <Card className="gap-1 rounded-lg border-0 bg-transparent p-0 shadow-none lg:bg-muted lg:p-6">
                <H2 className="font-sans text-2xl font-normal leading-normal lg:text-xl lg:font-semibold">
                  <span className="lg:hidden">{t("startWithTask")}</span>
                  <span className="hidden lg:inline">{t("exploreTopics")}</span>
                </H2>
                {categories.items.map((category) => (
                  <div key={category.id} className="flex flex-col gap-1 border-b border-border py-[18px] lg:py-4">
                    {topicDescriptions[category.slug] && (
                      <P className="text-lg leading-normal lg:order-2 lg:text-sm lg:text-muted-foreground">
                        {topicDescriptions[category.slug]}
                      </P>
                    )}
                    <TextLink
                      className="break-words py-1 text-base font-semibold no-underline hover:underline"
                      href={listingHref({}, { category: category.slug })}
                    >
                      {category.name} →
                    </TextLink>
                  </div>
                ))}
                {categoryCursor && (
                  <TextLink href={listingHref(filters, { categoryCursor: undefined })}>{t("firstTopics")}</TextLink>
                )}
                {categories.nextCursor && (
                  <TextLink href={listingHref(filters, { categoryCursor: categories.nextCursor })}>
                    {t("moreTopics")} →
                  </TextLink>
                )}
                <TextLink className="text-sm" href="/blog/feed.xml">
                  {t("subscribe")}
                </TextLink>
              </Card>
            </aside>
          ) : null
        }
      />
    </BlogPageContainer>
  );
}
