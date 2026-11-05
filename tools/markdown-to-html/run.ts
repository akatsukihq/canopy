import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly markdownFlavor: string;
  readonly sanitizeHtml: boolean;
  readonly openLinksSafely: boolean;
};

const HTML_CHARACTER_REFERENCE = /&(?:#\d+;?|#x[\da-f]+;?|[a-z][a-z\d]+;)/i;

function isSafeUrl(value: string): boolean {
  const schemeCandidate = /^[^/?]*/.exec(value.trimStart())?.[0] ?? "";
  if (HTML_CHARACTER_REFERENCE.test(schemeCandidate)) return false;
  try {
    const { protocol } = new URL(value, "https://smarttools.local");
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const source = requireUtilityInput(ctx.input.text, "Markdown input");
  // Dynamic so marked stays out of the initial bundle.
  const { marked, Renderer } = await import("marked");
  const renderer = ctx.settings.openLinksSafely || ctx.settings.sanitizeHtml ? new Renderer() : undefined;
  if (renderer) {
    const renderLink = renderer.link.bind(renderer);
    renderer.link = function (token) {
      if (ctx.settings.sanitizeHtml && !isSafeUrl(token.href)) {
        return this.parser.parseInline(token.tokens);
      }
      const link = renderLink(token);
      return ctx.settings.openLinksSafely ? link.replace(">", ' target="_blank" rel="noopener noreferrer">') : link;
    };
    if (ctx.settings.sanitizeHtml) {
      const renderImage = renderer.image.bind(renderer);
      renderer.html = () => "";
      renderer.image = function (token) {
        return isSafeUrl(token.href) ? renderImage(token) : this.parser.parseInline(token.tokens);
      };
    }
  }
  const html = String(
    await marked.parse(source, {
      gfm: ctx.settings.markdownFlavor !== "commonmark",
      renderer,
    }),
  );
  ctx.signal.throwIfAborted();
  return { render: "html", html, downloadName: "converted.html" };
};

export default run;
