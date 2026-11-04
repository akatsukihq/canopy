import { appHref } from "@/lib/routing/subdomains.ts";
import { z } from "zod";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/authorization/index.ts";
import { getUserAuthorization } from "@/lib/admin/index.ts";
import { AdminListing } from "../../../components/AdminListing";
import { AlertBanner, BackButton } from "@/components/ui/index.tsx";
import { requirePagePermission } from "@/lib/admin/access";
import { getBlogPost, getBlogRevision, listBlogRevisions } from "@/lib/blog/queries";
import { BlogRevisionList } from "../../components/BlogRevisionList";
import { renderBlogDocument } from "@/lib/blog/document";
import { blogImageDelivery } from "@/lib/blog/utils";
import styles from "../../components/blog-management.module.css";

export default async function BlogHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string; page?: string; revision?: string }>;
}) {
  const session = await requirePagePermission("blog", "view");
  const { id } = await params;
  const { page, revision } = await searchParams;
  const pageNumber = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).catch(1).parse(page);
  if (revision && !/^[a-zA-Z0-9_-]{1,100}$/.test(revision)) notFound();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) notFound();
  const [post, revisions, authorization] = await Promise.all([
    getBlogPost(session.user.id, id),
    listBlogRevisions(session.user.id, id, undefined, pageNumber),
    getUserAuthorization(session.user.id),
  ]);
  if (!post) notFound();
  const compared = revision ? await getBlogRevision(session.user.id, id, revision) : null;
  if (revision && !compared) notFound();
  const previewHtml = (document: typeof post.draftDocument) =>
    renderBlogDocument(document).html.replace(
      /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      '<span>$2 <span class="text-sm text-muted-foreground">($1)</span></span>',
    );
  const comparison = compared && (
    <>
      <AlertBanner variant="info" title="Compare before restoring">
        Both saved versions are preserved. Unsaved editor changes are not shown here. Restoring replaces the whole
        draft, including its settings and cover; it never publishes a revision.
      </AlertBanner>
      <div className={styles.comparison}>
        {[
          { label: `Revision ${compared.revisionNumber}`, document: compared.document },
          { label: "Current saved draft", document: post.draftDocument },
        ].map(({ label, document }) => (
          <section key={label} className={styles.comparisonPanel}>
            <h4 className="mb-4 text-sm font-semibold text-muted-foreground">{label}</h4>
            <p className="mb-5 text-lg font-semibold">{document.title || "Untitled post"}</p>
            <p className="mb-5 text-sm text-muted-foreground">{document.excerpt}</p>
            <dl className="mb-6 grid gap-3 border-y border-border py-4 text-sm">
              {[
                ["Byline", document.authorName || "Not set"],
                ["Category", document.category ? `${document.category.label} (${document.category.id})` : "None"],
                ["Tags", document.tags.map((tag) => `${tag.label} (${tag.id})`).join(", ") || "None"],
                ["SEO title", document.seoTitle ?? "Uses article title"],
                ["SEO description", document.seoDescription ?? "Uses article excerpt"],
                ["Related tool IDs", document.relatedToolIds.join(", ") || "None"],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="font-medium">{name}</dt>
                  <dd className="break-words text-muted-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            {document.coverImage ? (
              <figure className="mb-6 space-y-2">
                <img
                  className="h-auto max-w-full rounded-md"
                  {...blogImageDelivery(document.coverImage)}
                  sizes="(max-width: 767px) calc(100vw - 80px), calc(50vw - 108px)"
                  alt={document.coverImage.alt}
                  width={document.coverImage.media.width}
                  height={document.coverImage.media.height}
                />
                <figcaption className="break-words text-xs text-muted-foreground">
                  Cover: {document.coverImage.media.entry.publicId} · Version {document.coverImage.media.entry.version}{" "}
                  · {document.coverImage.media.width} × {document.coverImage.media.height} ·{" "}
                  {document.coverImage.media.format}
                  <br />
                  Alt text: {document.coverImage.alt || "Not set"}
                  <br />
                  Caption: {document.coverImage.caption || "None"}
                </figcaption>
              </figure>
            ) : (
              <p className="mb-6 text-sm text-muted-foreground">No cover image</p>
            )}
            <h5 className="mb-4 font-semibold">Article body</h5>
            <article
              className="space-y-4 [&_p]:my-3 [&_h2]:text-xl [&_ul]:list-disc [&_ul]:pl-5 [&_pre]:overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: previewHtml(document) }}
            />
          </section>
        ))}
      </div>
    </>
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-5 p-5 md:p-10 [&>header]:shrink-0">
      <header className="flex items-start gap-2">
        <BackButton href={appHref(`/admin/blog/${id}`)} label="Back to editor" />
        <h1 className="text-[30px] font-semibold leading-normal">Revision history</h1>
      </header>
      <p className="break-words text-lg font-medium">{post.draftDocument.title || "Untitled post"}</p>
      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="mb-2 text-xl font-semibold">Saved revisions</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Preview or compare a version before restoring it. The public article stays unchanged.
        </p>
        <AdminListing
          aria-label="Saved revisions"
          pagination={{
            "aria-label": "Revision pages",
            page: revisions.page,
            pageCount: revisions.pageCount,
            getPageHref: (page) => appHref(`/admin/blog/${id}/history?page=${page}`),
            summary: `Showing ${revisions.total ? (revisions.page - 1) * 25 + 1 : 0}–${(revisions.page - 1) * 25 + revisions.items.length} of ${revisions.total} revisions`,
          }}
        >
          <BlogRevisionList
            comparedRevisionId={compared?.id}
            comparison={comparison}
            historyPage={revisions.page}
            revisions={
              compared && !revisions.items.some((item) => item.id === compared.id)
                ? [{ ...compared, title: compared.document.title }, ...revisions.items]
                : revisions.items
            }
            postId={id}
            version={post.version}
            publishedRevisionId={post.publishedRevisionId}
            canRestore={!post.trashedAt && hasPermission(authorization.access, "blog", "edit")}
          />
        </AdminListing>
      </div>
    </div>
  );
}
