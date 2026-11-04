/**
 * Moved verbatim from the `meta-tag-generator` case in
 * `lib/devtools/format-json.ts`. Every interpolated value passes through the
 * shared `escapeHtml` exactly as it did before — the escaping is not widened,
 * narrowed, or re-implemented, because this tool emits markup from user input.
 */

import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { escapeHtml } from "../../lib/devtools/shared/text.ts";
import { safeUrl } from "../../lib/devtools/shared/url.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly keywords: string;
  readonly author: string;
  readonly canonical: string;
  readonly image: string;
  readonly locale: string;
  readonly robots: string;
  readonly includeOpenGraph: boolean;
  readonly includeTwitterCard: boolean;
  readonly addViewport: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const title = escapeHtml(requireUtilityInput(ctx.input.text, "Page title"));
  const description = escapeHtml(requireUtilityInput(ctx.input.secondary ?? "", "Meta description"));
  const keywords = ctx.settings.keywords.trim();
  const author = ctx.settings.author.trim();
  const canonical = ctx.settings.canonical.trim();
  const image = ctx.settings.image.trim();
  const locale = ctx.settings.locale === "none" ? "" : ctx.settings.locale;
  const robots = ctx.settings.robots === "none" ? "" : ctx.settings.robots.replace("_", ", ");
  if (canonical) safeUrl(canonical, "Canonical URL");
  if (image) safeUrl(image, "Open Graph image URL");
  return {
    render: "text",
    text: [
      `<title>${title}</title>`,
      `<meta name="description" content="${description}">`,
      ...(keywords ? [`<meta name="keywords" content="${escapeHtml(keywords)}">`] : []),
      ...(author ? [`<meta name="author" content="${escapeHtml(author)}">`] : []),
      ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}">`] : []),
      ...(robots ? [`<meta name="robots" content="${escapeHtml(robots)}">`] : []),
      ...(ctx.settings.addViewport ? [`<meta name="viewport" content="width=device-width, initial-scale=1">`] : []),
      ...(ctx.settings.includeOpenGraph
        ? [
            `<meta property="og:title" content="${title}">`,
            `<meta property="og:description" content="${description}">`,
            ...(canonical ? [`<meta property="og:url" content="${escapeHtml(canonical)}">`] : []),
            ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}">`] : []),
            ...(locale ? [`<meta property="og:locale" content="${escapeHtml(locale)}">`] : []),
          ]
        : []),
      ...(ctx.settings.includeTwitterCard
        ? [
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:title" content="${title}">`,
            `<meta name="twitter:description" content="${description}">`,
            ...(image ? [`<meta name="twitter:image" content="${escapeHtml(image)}">`] : []),
          ]
        : []),
    ].join("\n"),
    downloadName: "meta-tags.html",
  };
};

export default run;
