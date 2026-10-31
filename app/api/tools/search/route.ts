import { getPublicToolListings } from "@/lib/tool-framework/catalog";
import { searchTools } from "@/lib/tool-catalog/index";
import { errorMessage } from "@/utils/errorMessage";
import { captureException } from "@sentry/core";
import { logError } from "@/lib/observability/logger.ts";
import { defaultLocale, isLocale } from "@/lib/i18n/config";

// Curated discovery order; names, URLs and availability still come from the public catalog.
const SUGGESTED_TOOL_IDS = [
  "devtools.json-formatter",
  "media.merge-pdf",
  "paperwork.invoice-generator",
  "devtools.qr-code-generator",
  "devtools.json-editor",
  "media.resize-image",
  "media.compress-image",
  "paperwork.receipt-generator",
  "paperwork.expense-report",
];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = params.get("locale") ?? defaultLocale;
  if (!isLocale(locale)) return Response.json({ error: "Unsupported locale" }, { status: 400 });
  const query = params.get("q")?.trim().toLowerCase() ?? "";
  const family = params.get("family");

  if (family !== null && family !== "paperwork" && family !== "devtools" && family !== "media") {
    return Response.json({ error: "Invalid tool family" }, { status: 400 });
  }

  if (!query && params.get("suggestions") !== "1") return Response.json({ results: [] });

  try {
    const tools = await getPublicToolListings(locale, family ?? undefined);
    const matchingTools = family === null ? tools : tools.filter((tool) => tool.app === family);
    let selectedTools = query
      ? searchTools(matchingTools, query)
      : [
          ...SUGGESTED_TOOL_IDS.flatMap((toolId) => matchingTools.filter((tool) => tool.toolId === toolId)),
          ...matchingTools.filter((tool) => !SUGGESTED_TOOL_IDS.includes(tool.toolId)),
        ];
    if (!query) {
      selectedTools = family
        ? selectedTools.slice(0, 3)
        : selectedTools.filter(
            (tool, index, ordered) => ordered.findIndex((entry) => entry.app === tool.app) === index,
          );
    }
    const results = selectedTools.map((tool) => ({
      category: tool.category,
      description: tool.description,
      href: tool.href,
      icon: tool.icon,
      name: tool.name,
      toolId: tool.toolId,
      locale: tool.locale,
    }));

    return Response.json({ results });
  } catch (error) {
    captureException(error);
    logError("api.tools.search.failed", error);
    return Response.json({ error: errorMessage(error, "Unable to search tools") }, { status: 500 });
  }
}
