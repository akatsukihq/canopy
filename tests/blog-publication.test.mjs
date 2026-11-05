import { test, expect } from "vitest";
import { blogCanonicalUrl, blogArticleMetadata, blogStructuredData, buildBlogFeed } from "../lib/blog/publication.ts";
import { createBlogDocument } from "../lib/blog/document.ts";

const post = {
  slug: "first-post",
  document: {
    ...createBlogDocument("Title <&>"),
    excerpt: "Useful summary",
    seoTitle: "SEO title",
  },
  firstPublishedAt: new Date("2026-09-16T00:00:00Z"),
  publishedUpdatedAt: new Date("2026-09-16T01:00:00Z"),
};
test("article metadata uses canonical immutable slug, explicit overrides and publication dates", () => {
  expect(blogCanonicalUrl("first-post", "https://example.test/base")).toBe("https://example.test/blog/first-post");
  expect(() => blogCanonicalUrl("../private", "https://example.test")).toThrow();
  expect(() => blogCanonicalUrl("post", "javascript:alert(1)")).toThrow();
  const metadata = blogArticleMetadata(post, "https://example.test");
  expect(metadata.title).toBe("SEO title");
  expect(metadata.description).toBe("Useful summary");
  expect(metadata.alternates.canonical).toBe("https://example.test/blog/first-post");
  expect(metadata.openGraph.publishedTime).toBe("2026-09-16T00:00:00.000Z");
  expect(metadata.openGraph.modifiedTime).toBe("2026-09-16T01:00:00.000Z");
  expect(() => blogArticleMetadata({ ...post, firstPublishedAt: null }, "https://example.test")).toThrow(/timestamp/);
  expect(() => blogCanonicalUrl("post", "https://user:pass@example.test")).toThrow();
  const imagePost = {
    ...post,
    document: {
      ...post.document,
      coverImage: {
        media: {
          v: 1,
          provider: "cloudinary",
          format: "png",
          width: 1200,
          height: 630,
          uploadedAt: "2026-01-01T00:00:00.000Z",
          entry: {
            cloudName: "test-cloud",
            publicId: "smarttools/blog/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            version: 123,
          },
        },
        alt: "Cover",
        caption: "",
      },
    },
  };
  const withImage = blogArticleMetadata(imagePost, "https://example.test");
  expect(withImage.twitter.card).toBe("summary_large_image");
  expect(withImage.openGraph.images[0]).toMatchObject({ width: 1200, height: 630 });
  expect(withImage.openGraph.images[0].url).toBe(
    "https://res.cloudinary.com/test-cloud/image/upload/v123/smarttools/blog/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png",
  );
  expect(JSON.parse(blogStructuredData(imagePost, "https://example.test")).image).toBe(
    withImage.openGraph.images[0].url,
  );
});
test("structured data is safe to embed in an application/ld+json script", () => {
  const json = blogStructuredData(
    { ...post, document: { ...post.document, title: "</script><script>alert(1)</script>" } },
    "https://example.test",
  );
  expect(json).not.toMatch(/<script|<\/script/i);
  const data = JSON.parse(json);
  expect(data["@type"]).toBe("BlogPosting");
  expect(data.author.name).toBe("SmartTools Team");
  expect(data.mainEntityOfPage).toBe("https://example.test/blog/first-post");
});
test("RSS escapes stored text and uses publication dates rather than draft updates", () => {
  const xml = buildBlogFeed(
    [
      {
        slug: post.slug,
        title: '<Title & "quote">',
        excerpt: "Description </item>",
        authorName: "Writer",
        firstPublishedAt: post.firstPublishedAt,
        publishedUpdatedAt: post.publishedUpdatedAt,
      },
    ],
    "https://example.test",
  );
  expect(xml).toMatch(/&lt;Title &amp; &quot;quote&quot;&gt;/);
  expect(xml).toMatch(/Description &lt;\/item&gt;/);
  expect(xml).toMatch(/<pubDate>Wed, 16 Sep 2026 00:00:00 GMT<\/pubDate>/);
  expect(xml).toMatch(/https:\/\/example.test\/blog\/first-post/);
  expect(xml).not.toMatch(/draft|actor|createdBy/);
  expect(buildBlogFeed([], "https://example.test")).toMatch(/<channel>/);
});
