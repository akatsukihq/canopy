import { createCodeHighlightBudget, highlightCode } from "../../lib/markdown/codeHighlight.ts";
import { parseSettings, type SettingsSpec } from "../../lib/tool-framework/settings.ts";
import { renderMarkdownPreview, type MarkdownPreviewSettings } from "./run.worker.ts";

type HighlightRequest =
  | { id: number; operation: "highlight"; code: string; language?: string }
  | {
      id: number;
      operation: "export";
      source: string;
      settings: Record<string, unknown>;
      settingsSpec: SettingsSpec;
    };

const budget = createCodeHighlightBudget();
const scope = globalThis as unknown as {
  addEventListener(type: "message", handler: (event: MessageEvent<unknown>) => void): void;
  postMessage(value: { id: number; html?: string; error?: string }): void;
};

scope.addEventListener("message", async ({ data }) => {
  if (!data || typeof data !== "object" || !("id" in data) || !Number.isSafeInteger(data.id)) return;
  const request = data as HighlightRequest;
  try {
    let html: string;
    if (request.operation === "highlight" && typeof request.code === "string") {
      html = highlightCode(request.code, typeof request.language === "string" ? request.language : undefined, budget);
    } else if (request.operation === "export" && typeof request.source === "string") {
      const result = await renderMarkdownPreview(
        request.source,
        parseSettings(request.settingsSpec, request.settings) as MarkdownPreviewSettings,
        {
          deferHighlighting: false,
        },
      );
      html = result.html;
    } else {
      throw new Error("Invalid Markdown preview request.");
    }
    scope.postMessage({ id: request.id, html });
  } catch (error) {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Markdown rendering failed." });
  }
});
