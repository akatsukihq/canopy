import { getInitialBlogGeneration } from "@/lib/blog/generation";
import { BlogGenerationRecovery } from "../components/BlogGenerationRecovery";
import { loadRuntimeSettings } from "@/lib/config/runtimeSettings.ts";
import { activeRun } from "@/lib/assistant/client";
import config from "@/lib/config/config.ts";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/authorization/index.ts";
import { getUserAuthorization } from "@/lib/admin/index.ts";
import { requirePagePermission } from "@/lib/admin/access";
import { getBlogPost } from "@/lib/blog/queries";
import { getToolListings } from "@/lib/tool-framework/catalog";
import { BlogEditor } from "../components/BlogEditor";
import { loadBlogTaxonomyOptions } from "../lib/loadBlogTaxonomyOptions";

export default async function BlogEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string; thread?: string; edit?: string }>;
}) {
  const session = await requirePagePermission("blog", "view");
  const { id } = await params;
  const query = await searchParams;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) notFound();
  const [post, categories, tags, authorization, tools] = await Promise.all([
    getBlogPost(session.user.id, id),
    loadBlogTaxonomyOptions(session.user.id, "category"),
    loadBlogTaxonomyOptions(session.user.id, "tag"),
    getUserAuthorization(session.user.id),
    Promise.all([getToolListings("devtools"), getToolListings("media")]).then((groups) => groups.flat()),
  ]);
  if (!post) notFound();
  const generation = (await loadRuntimeSettings())["ai.enabled"].value === true ? await getInitialBlogGeneration(session.user.id, id) : null;
  if (generation && (activeRun(generation.status) || (generation.status !== "completed" && query.edit !== "1")))
    return <BlogGenerationRecovery initialRun={generation} />;
  return (
    <BlogEditor
      key={`${post.id}:${post.version}`}
      actorId={session.user.id}
      publicPostHref={new URL(`/blog/${post.slug}`, config.appUrl).href}
      initialAssistantReview={query.review === "1"}
      post={post}
      categories={categories}
      tags={tags}
      tools={tools.map((tool) => ({ id: tool.toolId, name: tool.name }))}
      canEdit={hasPermission(authorization.access, "blog", "edit")}
      canPublish={hasPermission(authorization.access, "blog", "publish")}
      canCreate={hasPermission(authorization.access, "blog", "create")}
      cloudName={config.cloudinary.cloudName?.trim() ?? ""}
    />
  );
}
