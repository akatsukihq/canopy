/**
 * Moved verbatim from the `sitemap-generator` case in
 * `lib/devtools/format-json.ts`. Each `loc` value keeps the same shared
 * `escapeHtml` call it had before — unchanged, because this tool emits markup
 * built from user input.
 */

import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import { escapeHtml } from "../../lib/devtools/shared/text.ts";
import { safeUrl } from "../../lib/devtools/shared/url.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const lines = requireUtilityInput(ctx.input.text, "URLs")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 50_000) {
    throw new ToolError(
      "too-many-urls",
      "Sitemap cannot exceed 50,000 URLs.",
      "Split the list across several sitemaps and publish a sitemap index.",
      { messageRef: { key: "errors.too-many-urls" }, recoveryMessage: { key: "recovery.too-many-urls" } },
    );
  }
  const urls = [...new Set(lines)].map((value) => safeUrl(value, "Sitemap URL").toString());
  return {
    render: "text",
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`)
      .join("\n")}\n</urlset>`,
    downloadName: "sitemap.xml",
  };
};

export default run;
