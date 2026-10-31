import { getSession } from "@/lib/auth/session.ts";
import { captureException } from "@sentry/core";
import { logError } from "@/lib/observability/logger.ts";
import { z } from "zod";
import { getPublicToolListings } from "@/lib/tool-framework/catalog";
import { changeSavedTools, getSavedTools } from "@/lib/user-preferences/savedTools";
import { isSameOriginRequest } from "@/lib/routing/requestOrigin.ts";
import { defaultLocale, isLocale, unlocalizedPathname, type Locale } from "@/lib/i18n/config";

const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const mutation = z
  .object({
    userId: z.string().min(1).max(200),
    operation: z.enum(["merge", "save", "remove"]),
    toolIds: z
      .array(
        z
          .string()
          .max(160)
          .regex(/^[a-z][a-z0-9-]*\.[a-z0-9]+(?:-[a-z0-9]+)*$/),
      )
      .max(500),
  })
  .strict()
  .refine((value) => value.operation === "merge" || value.toolIds.length === 1);

async function bookmarkCatalog(locale: Locale = defaultLocale) {
  return (await getPublicToolListings(locale)).map(({ toolId, name, href, category, locale: toolLocale }) => ({
    toolId,
    name,
    href: unlocalizedPathname(href),
    category,
    locale: toolLocale,
  }));
}

export async function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("locale") ?? defaultLocale;
  if (!isLocale(locale)) return json({ error: "Unsupported locale" }, 400);
  try {
    const session = await getSession(request.headers, { includeAdmin: false });
    if (session && session.user.status !== "active")
      return json({ error: "This account cannot access saved tools." }, 403);
    const [tools, savedTools] = await Promise.all([
      bookmarkCatalog(locale),
      session ? getSavedTools(session.user.id) : Promise.resolve([]),
    ]);
    return json({
      userId: session?.user.id ?? null,
      savedTools,
      tools,
    });
  } catch (error) {
    captureException(error);
    logError("api.saved_tools.read_failed", error);
    return json({ error: "Couldn’t load saved tools. Please try again." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Expected JSON." }, 415);
  try {
    const session = await getSession(request.headers, { includeAdmin: false });
    if (!session) return json({ error: "Your session ended. Sign in again to change account bookmarks." }, 401);
    if (session.user.status !== "active") return json({ error: "This account cannot change saved tools." }, 403);
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 100_000) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const parsed = mutation.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid saved-tools request." }, 400);
    const { userId, operation } = parsed.data;
    // The submitted identity is a stale-session guard, never the authority.
    if (userId !== session.user.id) return json({ error: "Your account changed. Reload Saved and try again." }, 409);
    const available = new Set((await bookmarkCatalog()).map((tool) => tool.toolId));
    const ids = [...new Set(parsed.data.toolIds)].filter((id) => operation === "remove" || available.has(id));
    if (operation === "save" && ids.length === 0) return json({ error: "This tool is no longer available." }, 400);
    const savedTools = await changeSavedTools(session.user.id, operation, ids);
    return json({ userId: session.user.id, savedTools });
  } catch (error) {
    captureException(error);
    logError("api.saved_tools.write_failed", error);
    return json({ error: "Couldn’t confirm the update. Reload Saved and try again." }, 503);
  }
}
