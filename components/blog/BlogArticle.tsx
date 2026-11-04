import { useLocale, useTranslations } from "next-intl";
import { localizeHref, type Locale } from "@/lib/i18n/config";
import { ArrowRight } from "lucide-react";
import "katex/dist/katex.min.css";
import {
  Avatar,
  AvatarFallback,
  BackButton,
  Button,
  Caption,
  Card,
  H1,
  H2,
  Overline,
  P,
  TextLink,
} from "@/components/ui/index.tsx";
import { renderBlogDocument, type BlogDocument } from "@/lib/blog/document";
import { blogImageDelivery } from "@/lib/blog/utils";
import { blogCanonicalUrl } from "@/lib/blog/publication";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { CopyBlogLink } from "./CopyBlogLink";
import { BlogPageContainer } from "./BlogPageContainer";
import { RichContent } from "@/components/content/RichContent";
import styles from "./article.module.css";

type Props = {
  document: BlogDocument;
  publication?: {
    slug: string;
    categorySlug: string;
    firstPublishedAt: Date | null;
    publishedUpdatedAt: Date | null;
    tags: { id: string; label: string; slug: string }[];
    relatedToolLinks: { id: string; name: string; href: string }[];
  };
};

/** Live posts and saved previews deliberately share the same responsive renderer. */
export function BlogArticle({ document, publication }: Props) {
  const t = useTranslations("Blog");
  const locale = useLocale() as Locale;
  const content = renderBlogDocument(document);
  // Only transform the renderer's validated HTML, never the stored draft. Keep link
  // styling in previews without exposing navigation or keyboard-focusable links.
  const html = publication
    ? content.html
    : content.html.replace(/<a\b[^>]*>/g, '<span class="preview-link">').replace(/<\/a>/g, "</span>");
  const url = publication ? blogCanonicalUrl(publication.slug) : null;
  const tags = publication?.tags ?? [];
  const relatedToolLinks = publication?.relatedToolLinks ?? [];
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(value);
  return (
    <article className={styles.article}>
      <BlogPageContainer>
        <header className={styles.introduction}>
          <div className="flex items-center gap-3">
            {publication && <BackButton href={localizeHref("/blog", locale)} label={t("allStories")} />}
            <Overline className={`${styles.category} ms-auto min-w-0 break-words text-end`}>
              {publication ? (
                <TextLink
                  className="no-underline"
                  href={localizeHref(`/blog?category=${encodeURIComponent(publication.categorySlug)}`, locale)}
                >
                  {document.category?.label}
                </TextLink>
              ) : (
                (document.category?.label ?? t("uncategorized"))
              )}
            </Overline>
          </div>
          <H1 dir="auto" className={styles.title}>
            {document.title}
          </H1>
          <P dir="auto" className={styles.excerpt}>
            {document.excerpt}
          </P>
          <div className={styles.byline}>
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className="bg-accent text-primary">
                {document.authorName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <P dir="auto" className={styles.author}>
                {document.authorName}
              </P>
              <Caption className={styles.date}>
                {publication?.firstPublishedAt && (
                  <>
                    <time dateTime={publication.firstPublishedAt.toISOString()}>
                      {date(publication.firstPublishedAt)}
                    </time>{" "}
                    ·{" "}
                  </>
                )}
                {t("readingTime", { count: content.readingMinutes })}
              </Caption>
            </div>
            {url && <CopyBlogLink url={url} title={document.title} />}
          </div>
          {publication?.publishedUpdatedAt &&
            publication.firstPublishedAt &&
            publication.publishedUpdatedAt.getTime() !== publication.firstPublishedAt.getTime() && (
              <Caption className="text-muted-foreground">
                {t("updated")}{" "}
                <time dateTime={publication.publishedUpdatedAt.toISOString()}>
                  {date(publication.publishedUpdatedAt)}
                </time>
              </Caption>
            )}
        </header>
        {document.coverImage && (
          <figure className={styles.cover}>
            <img
              alt={document.coverImage.alt}
              {...blogImageDelivery(document.coverImage)}
              sizes="(min-width: 1440px) 1280px, (min-width: 1024px) calc(100vw - 160px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)"
              width={document.coverImage.media.width}
              height={document.coverImage.media.height}
              fetchPriority="high"
            />
            {document.coverImage.caption && <figcaption>{document.coverImage.caption}</figcaption>}
          </figure>
        )}
        <div className={styles.readingLayout}>
          {content.headings.length > 0 && (
            <nav aria-label={t("onPage")} className={styles.contents}>
              <Overline className={styles.contentsLabel}>{t("inGuide")}</Overline>
              <ul>
                {content.headings.map((heading) => (
                  <li key={heading.id} className={heading.level > 2 ? "ps-3" : ""}>
                    <TextLink href={`#${heading.id}`} className={`${styles.contentsLink} no-underline hover:underline`}>
                      {heading.text || t("untitledSection")}
                    </TextLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className={styles.main}>
            <div dir="auto">
              <RichContent showToaster html={html} />
            </div>
            {relatedToolLinks.length > 0 && (
              <Card className={styles.toolHandoff}>
                <H2 className="font-sans text-[26px] leading-[1.6]">{t("useGuide")}</H2>
                <P className="text-muted-foreground">{t("openTools")}</P>
                <div className="flex flex-wrap gap-3">
                  {relatedToolLinks.map((tool) => (
                    <Button asChild key={tool.id} className="max-w-full whitespace-normal text-start">
                      <a href={localizeHref(tool.href, locale)}>
                        {tool.name} <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                      </a>
                    </Button>
                  ))}
                </div>
              </Card>
            )}
            {tags.length > 0 && (
              <nav aria-label={t("articleTags")} className="my-6 flex flex-wrap gap-3">
                {tags.map((tag) => (
                  <Button asChild key={tag.id} variant="outline" size="sm" className="max-w-full whitespace-normal">
                    <a href={localizeHref(`/blog?tag=${encodeURIComponent(tag.slug)}`, locale)}>{tag.label}</a>
                  </Button>
                ))}
              </nav>
            )}
          </div>
        </div>
      </BlogPageContainer>
      {!publication && (
        <div className={styles.previewFooter} inert>
          <CanopyFooter />
        </div>
      )}
    </article>
  );
}
