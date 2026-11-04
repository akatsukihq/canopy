"use client";
import { useTranslations as useToolTranslations } from "next-intl";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RichContent } from "@/components/content/RichContent";
import { downloadResultContent, ResultActions, ResultView } from "@/components/ResultView";
import { SandboxedHtmlPreview } from "@/components/SandboxedHtmlPreview";
import { ToolWorkspace, type WorkspaceProps } from "@/components/ToolWorkspace";
import { ToolActionButton, toast } from "@/components/ui/index.tsx";
import { trackToolEvent } from "@/lib/analytics/ga4";
import { useAnalyticsToolKey } from "@/lib/tool-runtime/useToolRuntime";
import type { ToolHtmlRender, ToolResult } from "@/lib/tool-framework/result";
import { createMarkdownHighlightClient } from "./highlightClient";
import styles from "./Preview.module.css";

function MarkdownExportActions({
  result,
  source,
  settings,
  client,
}: {
  result: ToolHtmlRender;
  source: string;
  settings: WorkspaceProps["settings"];
  client: ReturnType<typeof createMarkdownHighlightClient>;
}) {
  const toolText = useToolTranslations("Tool.runtime");
  const [pending, setPending] = useState<"copy" | "download" | null>(null);
  const active = useRef(true);
  const prepared = useRef<Promise<string> | undefined>(undefined);
  const toolKey = useAnalyticsToolKey();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function exportDocument(action: "copy" | "download") {
    if (pending) return;
    setPending(action);
    try {
      const content = (prepared.current ??= client.exportHtml(source, settings));
      const checkedContent = content.then((html) => {
        if (!active.current) throw new DOMException("Preview was replaced.", "AbortError");
        return html;
      });
      if (action === "copy") {
        // Keep the clipboard request inside the click gesture while the worker prepares the full document.
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": checkedContent.then((html) => new Blob([html], { type: "text/plain" })),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(await checkedContent);
        }
        if (active.current) {
          trackToolEvent("result_copy", toolKey);
          toast.success(toolText("workspace.html_copied_f641d9"));
        }
      } else {
        const html = await checkedContent;
        downloadResultContent(html, "text/html;charset=utf-8", result.downloadName ?? "preview.html", toolKey);
      }
    } catch (error) {
      prepared.current = undefined;
      if (active.current && !(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(toolText(action === "copy" ? "export.copyFailed" : "export.downloadFailed"));
      }
    } finally {
      if (active.current) setPending(null);
    }
  }

  return (
    <>
      <ToolActionButton
        action="copy"
        disabled={pending !== null}
        loading={pending === "copy"}
        onClick={() => void exportDocument("copy")}
      >
        {pending === "copy" ? toolText("workspace.preparing_5d1fa3") : toolText("workspace.copy_e21f93")}
      </ToolActionButton>
      <ToolActionButton
        action="download"
        disabled={pending !== null}
        loading={pending === "download"}
        onClick={() => void exportDocument("download")}
      >
        {pending === "download" ? toolText("workspace.preparing_5d1fa3") : toolText("workspace.download_d6eafe")}
      </ToolActionButton>
    </>
  );
}

function scrollProgress(element: Element) {
  const distance = element.scrollHeight - element.clientHeight;
  return distance > 0 ? Math.max(0, Math.min(1, element.scrollTop / distance)) : 0;
}

export default function MarkdownWorkspace(props: WorkspaceProps) {
  const [retainedResult, setRetainedResult] = useState<ToolResult | null>(null);
  useEffect(() => {
    if (props.result) setRetainedResult(props.result);
    else if (!props.input.text) setRetainedResult(null);
  }, [props.result, props.input.text]);
  const highlightClient = useMemo(() => createMarkdownHighlightClient(props.spec.settings), [props.spec.settings]);
  useEffect(() => () => highlightClient.dispose(), [highlightClient]);
  const sourceRef = useRef<HTMLElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewProgressRef = useRef(0);
  const sourceProgressRef = useRef(0);
  const expectedScroll = useRef(new WeakMap<Element, number>());
  const syncEnabled = props.settings.syncScroll !== false;
  const syncEnabledRef = useRef(syncEnabled);
  syncEnabledRef.current = syncEnabled;

  const setScroll = useCallback((element: Element | null | undefined, progress: number) => {
    if (!element || !element.clientHeight) return;
    const nextTop = progress * Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(element.scrollTop - nextTop) < 1) return;
    element.scrollTop = nextTop;
    expectedScroll.current.set(element, element.scrollTop);
  }, []);

  const isSyncedScroll = (element: Element) => {
    const expected = expectedScroll.current.get(element);
    expectedScroll.current.delete(element);
    return expected !== undefined && Math.abs(element.scrollTop - expected) < 1;
  };

  // Restore the reading position after pane resizing or switching mobile tabs.
  const attachSource = useCallback(
    (element: HTMLElement | null) => {
      sourceRef.current = element;
      if (!element) return;
      const observer = new ResizeObserver(() => {
        setScroll(element, syncEnabledRef.current ? previewProgressRef.current : sourceProgressRef.current);
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        sourceRef.current = null;
      };
    },
    [setScroll],
  );

  useEffect(() => {
    if (!syncEnabled) return;
    const source = sourceRef.current;
    const progress = source?.clientHeight ? scrollProgress(source) : sourceProgressRef.current;
    previewProgressRef.current = progress;
    setScroll(iframeRef.current?.contentDocument?.scrollingElement, progress);
  }, [setScroll, syncEnabled]);

  useEffect(() => {
    if (props.input.text) return;
    sourceProgressRef.current = 0;
    previewProgressRef.current = 0;
  }, [props.input.text]);

  return (
    <ToolWorkspace
      {...props}
      retainedResult={props.input.text ? retainedResult : null}
      sourceRef={attachSource}
      renderResultActions={(result) =>
        result.render === "html" && result.deferCodeHighlighting ? (
          <MarkdownExportActions
            result={result}
            source={props.input.text}
            settings={props.settings}
            client={highlightClient}
          />
        ) : (
          <ResultActions result={result} canCopy canDownload />
        )
      }
      onSourceScroll={(source) => {
        if (!source.clientHeight || isSyncedScroll(source)) return;
        const progress = scrollProgress(source);
        sourceProgressRef.current = progress;
        if (!syncEnabled) return;
        previewProgressRef.current = progress;
        setScroll(iframeRef.current?.contentDocument?.scrollingElement, progress);
      }}
      renderResult={(result) =>
        result.render === "html" ? (
          <SandboxedHtmlPreview
            className="min-h-0"
            variant="document"
            html={result.html}
            preserveScrollAnchor={result.html.length > 100_000}
            iframeRef={iframeRef}
            scrollProgressRef={previewProgressRef}
            onScroll={(progress) => {
              const preview = iframeRef.current?.contentDocument?.scrollingElement;
              if (!preview?.clientHeight || isSyncedScroll(preview)) return;
              previewProgressRef.current = progress;
              if (!syncEnabled) return;
              sourceProgressRef.current = progress;
              setScroll(sourceRef.current, progress);
            }}
          >
            <article className={`${styles.preview} w-full`}>
              <RichContent
                html={result.html}
                showToaster
                deferSections={result.html.length > 100_000}
                highlightCode={result.deferCodeHighlighting ? highlightClient.highlight : undefined}
              />
            </article>
          </SandboxedHtmlPreview>
        ) : (
          <ResultView result={result} />
        )
      }
    />
  );
}
