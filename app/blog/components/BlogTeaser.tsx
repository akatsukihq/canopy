import { ArrowUpRight } from "lucide-react";
import { useLocale } from "next-intl";
import { localizeHref, type Locale } from "@/lib/i18n/config";
import { Avatar, AvatarFallback, Caption, H3, Overline, P, TextLink } from "@/components/ui/index.tsx";
import type { listPublishedBlogPosts } from "@/lib/blog/queries";

type Post = Awaited<ReturnType<typeof listPublishedBlogPosts>>["items"][number];

export function BlogByline({
  post,
  showAvatar = false,
}: {
  post: Pick<Post, "authorName" | "firstPublishedAt">;
  showAvatar?: boolean;
}) {
  const locale = useLocale();
  const metadata = (
    <Caption className="block font-sans text-xs leading-normal text-muted-foreground">
      {post.authorName}
      {post.firstPublishedAt && (
        <>
          {" "}
          ·{" "}
          <time dateTime={post.firstPublishedAt.toISOString()}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(post.firstPublishedAt)}
          </time>
        </>
      )}
    </Caption>
  );
  if (!showAvatar) return metadata;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar aria-hidden="true" className="size-6 shrink-0">
        <AvatarFallback className="bg-accent text-[10px] font-medium text-accent-text">
          {post.authorName
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
      {metadata}
    </span>
  );
}

export function BlogTeaser({
  post,
  variant = "list",
  coverDelivery,
  number = 1,
}: {
  post: Post;
  variant?: "list" | "search" | "related";
  coverDelivery?: { src: string; srcSet: string };
  number?: number;
}) {
  const locale = useLocale() as Locale;
  if (variant === "related") {
    return (
      <article className="min-w-0 h-full">
        <TextLink
          href={localizeHref(`/blog/${post.slug}`, locale)}
          aria-label={post.title}
          className="group flex h-full min-w-0 flex-col gap-4 rounded-sm text-foreground no-underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <div
            aria-hidden="true"
            className="flex items-center justify-between border-b border-input pb-3 text-accent-text"
          >
            <span className="font-caption text-[32px] font-normal leading-none">{String(number).padStart(2, "0")}</span>
            <ArrowUpRight className="size-5 shrink-0 rtl:-scale-x-100" />
          </div>
          <div className="space-y-2.5">
            <Overline className="block break-words font-sans text-xs font-semibold leading-normal tracking-normal text-accent-text">
              {post.category.label}
            </Overline>
            <div className="flex flex-col gap-1">
              <H3 className="break-words font-sans text-[24px] font-semibold leading-[1.2] tracking-[-0.4px] group-hover:text-accent-text group-focus-visible:text-accent-text">
                {post.title}
              </H3>
              <P className="break-words text-[15px] leading-normal text-muted-foreground">{post.excerpt}</P>
            </div>
            <BlogByline post={post} showAvatar />
          </div>
        </TextLink>
      </article>
    );
  }

  return (
    <article
      className={`min-w-0 space-y-3 ${variant === "list" ? "lg:space-y-2 lg:border-b lg:border-border lg:py-5" : ""}`}
    >
      {coverDelivery && post.coverImage && (
        <img
          {...coverDelivery}
          sizes="(min-width: 640px) 400px, calc(100vw - 40px)"
          alt={post.coverImage.alt}
          width={post.coverImage.media.width}
          height={post.coverImage.media.height}
          className="h-[230px] w-full rounded-lg object-cover sm:w-[400px]"
        />
      )}
      <Overline className="block font-sans text-xs font-normal leading-normal tracking-normal text-accent-text">
        <TextLink
          className="no-underline"
          href={localizeHref(`/blog?category=${encodeURIComponent(post.category.slug)}`, locale)}
        >
          {post.category.label}
        </TextLink>
      </Overline>
      <div className="flex flex-col gap-1">
        <H3
          className={`font-sans text-[25px] leading-[1.2] ${variant === "list" ? "lg:text-[23px] lg:leading-[1.25]" : ""}`}
        >
          <TextLink
            className="break-words text-foreground no-underline hover:underline"
            href={localizeHref(`/blog/${post.slug}`, locale)}
          >
            {post.title}
          </TextLink>
        </H3>
        <P className="break-words text-[15px] leading-normal text-muted-foreground">{post.excerpt}</P>
      </div>
      <BlogByline post={post} />
    </article>
  );
}
