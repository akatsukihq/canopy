import config from "../config/config.ts";
import type { Metadata } from "next";
import { z } from "zod";
import { blogImageUrl, validateBlogDocument, type BlogDocument } from "./document.ts";
import { organizationId, organizationReference, serializeJsonLd } from "../seo/structuredData.ts";

type PublishedArticle = {
  slug: string;
  document: BlogDocument;
  firstPublishedAt: Date | null;
  publishedUpdatedAt: Date | null;
};
type FeedArticle = {
  slug: string;
  title: string;
  excerpt: string;
  firstPublishedAt: Date | null;
  publishedUpdatedAt: Date | null;
};
const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function blogCanonicalUrl(slug: string, appUrl = config.appUrl): string {
  slugSchema.parse(slug);
  const base = new URL(appUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password)
    throw new Error("Invalid APP_URL.");
  return new URL(`/blog/${slug}`, base).href;
}

function publishedDate(value: Date | null): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Published article timestamp is missing.");
  return value;
}

export function blogArticleMetadata(post: PublishedArticle, appUrl?: string): Metadata {
  const document = validateBlogDocument(post.document);
  const url = blogCanonicalUrl(post.slug, appUrl);
  const title = document.seoTitle || document.title;
  const description = document.seoDescription || document.excerpt;
  const image = document.coverImage
    ? {
        url: blogImageUrl(document.coverImage),
        width: document.coverImage.media.width,
        height: document.coverImage.media.height,
        alt: document.coverImage.alt,
      }
    : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: "SmartTools",
      publishedTime: publishedDate(post.firstPublishedAt).toISOString(),
      modifiedTime: publishedDate(post.publishedUpdatedAt).toISOString(),
      authors: [document.authorName],
      images: image ? [image] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image.url] : [],
    },
  };
}

/** Return script-safe JSON, including when trusted admins wrote literal closing script tags. */
export function blogStructuredData(post: PublishedArticle, appUrl?: string): string {
  const document = validateBlogDocument(post.document);
  const url = blogCanonicalUrl(post.slug, appUrl);
  return serializeJsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: document.title,
    description: document.seoDescription || document.excerpt,
    url,
    mainEntityOfPage: url,
    datePublished: publishedDate(post.firstPublishedAt).toISOString(),
    dateModified: publishedDate(post.publishedUpdatedAt).toISOString(),
    // A house byline ("SmartTools Team") is the organization, not a person.
    author: /^smarttools\b/i.test(document.authorName.trim())
      ? { "@id": organizationId(appUrl) }
      : { "@type": "Person", name: document.authorName },
    publisher: organizationReference(appUrl),
    ...(document.coverImage ? { image: blogImageUrl(document.coverImage) } : {}),
  });
}

function xml(value: string): string {
  return value
    .toWellFormed()
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

/** The caller supplies only published summaries from listPublishedBlogPosts. */
export function buildBlogFeed(posts: FeedArticle[], appUrl?: string): string {
  const blogUrl = new URL("/blog", blogCanonicalUrl("feed", appUrl)).href;
  const feedUrl = new URL("/blog/feed.xml", blogUrl).href;
  const items = posts
    .map((post) => {
      const url = xml(blogCanonicalUrl(post.slug, appUrl));
      return `<item><title>${xml(post.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${xml(post.excerpt)}</description><pubDate>${publishedDate(post.firstPublishedAt).toUTCString()}</pubDate></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>SmartTools Blog</title><link>${xml(blogUrl)}</link><description>Guides and updates from SmartTools.</description><language>en</language><atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
}
