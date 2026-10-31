import { TOOL_CATEGORIES } from "@/lib/tool-framework/categories";
import { getPublicToolListings } from "@/lib/tool-framework/catalog";
import { errorMessage } from "@/utils/errorMessage";
import { captureException } from "@sentry/core";
import { logError } from "@/lib/observability/logger.ts";
import { defaultLocale, isLocale, localizeHref } from "@/lib/i18n/config";
import { getCommonMessages } from "@/lib/i18n/messages";

const ECOSYSTEMS = [
  { app: "paperwork", href: "/paperwork", id: "documents", label: "Documents" },
  { app: "devtools", href: "/devtools", id: "developer", label: "Developer" },
  { app: "media", href: "/media", id: "media", label: "Media" },
] as const;

export async function GET(request?: Request) {
  const locale = request ? (new URL(request.url).searchParams.get("locale") ?? defaultLocale) : defaultLocale;
  if (!isLocale(locale)) return Response.json({ error: "Unsupported locale" }, { status: 400 });
  try {
    const tools = await getPublicToolListings(locale);
    const messages = getCommonMessages(locale);
    const groups = ECOSYSTEMS.map((ecosystem) => {
      const matchingTools = tools.filter((tool) => tool.app === ecosystem.app);
      const previews = matchingTools.map(({ href, icon, name, toolId }) => ({ href, icon, name, toolId }));
      return {
        ...ecosystem,
        label: messages.Common[ecosystem.id],
        href: localizeHref(ecosystem.href, locale),
        categories: Object.entries(TOOL_CATEGORIES)
          .filter(([, category]) => category.app === ecosystem.app)
          .map(([key]) => ({
            count: matchingTools.filter((tool) => tool.categoryKey === key).length,
            href: localizeHref(`${ecosystem.href}?category=${encodeURIComponent(key)}`, locale),
            label: messages.Categories[key as keyof typeof messages.Categories],
          })),
        count: matchingTools.length,
        tools: ecosystem.app === "paperwork" ? previews : previews.slice(0, 4),
      };
    });
    return Response.json({ groups });
  } catch (error) {
    captureException(error);
    logError("api.tools.ecosystem.failed", error);
    return Response.json({ error: errorMessage(error, "Unable to load tool categories") }, { status: 500 });
  }
}
