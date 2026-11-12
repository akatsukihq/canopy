import config from "@/lib/config/config.ts";
import { buildLlmsTxt } from "@/lib/seo/llmsTxt";
import { getPublicTools } from "@/lib/tool-framework/catalog";

// Same reason as the sitemap: tool enablement lives in the database.
export const dynamic = "force-dynamic";

export async function GET() {
  // An unavailable catalog still serves the suite map rather than failing the file.
  const tools = await getPublicTools().catch(() => []);
  return new Response(buildLlmsTxt(tools, config.appUrl), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
