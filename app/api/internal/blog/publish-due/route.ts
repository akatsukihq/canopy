import config from "@/lib/config/config.ts";
import { handleBlogPublishRequest } from "@/lib/blog/cron";
import { captureException } from "@sentry/core";
import { logError } from "@/lib/observability/logger.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleBlogPublishRequest(request, config.schedulerSecret, async () => {
    try {
      const { publishDueBlogPosts } = await import("@/lib/blog/mutations");
      return await publishDueBlogPosts();
    } catch (error) {
      captureException(error);
      logError("cron.blog_publish.failed", error);
      throw error;
    }
  });
}
