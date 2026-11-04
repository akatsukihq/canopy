/**
 * Parse Markdown in the tool worker. Large documents defer display highlighting
 * until their code is visible; exports request complete bounded highlighting.
 */

import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import type { ToolHtmlRender } from "../../lib/tool-framework/result.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";

export type MarkdownPreviewSettings = {
  readonly syncScroll: boolean;
  readonly previewMode: string;
  readonly syntaxHighlighting: boolean;
  readonly safeLinks: boolean;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]);
}

export async function renderMarkdownPreview(
  input: string,
  settings: MarkdownPreviewSettings,
  options: { deferHighlighting?: boolean } = {},
  signal?: AbortSignal,
): Promise<ToolHtmlRender> {
  signal?.throwIfAborted();
  const source = requireUtilityInput(input, "Markdown input");
  const deferCodeHighlighting = settings.syntaxHighlighting && (options.deferHighlighting ?? true);
  const { marked, Renderer } = await import("marked");
  const renderer =
    settings.safeLinks || (settings.syntaxHighlighting && !deferCodeHighlighting) ? new Renderer() : undefined;
  if (renderer && settings.safeLinks) {
    const renderLink = renderer.link.bind(renderer);
    renderer.link = (token) => renderLink(token).replace(">", ' target="_blank" rel="noopener noreferrer">');
  }
  if (renderer && settings.syntaxHighlighting && !deferCodeHighlighting) {
    const { highlightCode, createCodeHighlightBudget } = await import("../../lib/markdown/codeHighlight.ts");
    const budget = createCodeHighlightBudget();
    renderer.code = ({ text, lang }) => {
      const language = lang?.match(/^\S+/)?.[0];
      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      return `<pre><code${className}>${highlightCode(text.replace(/\n$/, ""), language, budget)}\n</code></pre>\n`;
    };
  }
  signal?.throwIfAborted();
  return {
    render: "html",
    html: String(
      await marked.parse(source, {
        gfm: settings.previewMode !== "commonmark",
        renderer,
      }),
    ),
    downloadName: "preview.html",
    ...(deferCodeHighlighting ? { deferCodeHighlighting: true } : {}),
  };
}

export const run: ToolRun<MarkdownPreviewSettings> = (ctx) =>
  renderMarkdownPreview(ctx.input.text, ctx.settings, undefined, ctx.signal);

export default run;
