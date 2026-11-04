"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/content/CodeEditor";
import { downloadResultContent } from "@/components/ResultView";
import { SplitStack } from "@/components/Stacks";
import { readTextFileForEditor } from "@/lib/tool-framework/textFileInput";
import { WorkspaceSurface } from "@/components/Surfaces";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import {
  Button,
  Muted,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ToolActionButton,
  toast,
} from "@/components/ui/index.tsx";
import { parseWebFiles, stringifyWebFiles, type WebFiles } from "./files";

const MAX_FILE_BYTES = 256 * 1024;

const FILES = [
  { key: "html", name: "index.html", language: "html" },
  { key: "css", name: "style.css", language: "css" },
  { key: "js", name: "script.js", language: "javascript" },
] as const satisfies readonly { key: keyof WebFiles; name: string; language: string }[];

type ConsoleLine = { readonly level: string; readonly text: string };

export default function HtmlCompilerWorkspace(props: WorkspaceProps) {
  const t = useTranslations("Tool.runtime");
  const { input, onInputChange, primaryAction, onToolbarActionsChange, result } = props;
  const [file, setFile] = useState<keyof WebFiles>("html");
  const [lines, setLines] = useState<readonly ConsoleLine[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);
  const latest = useRef(input);
  latest.current = input;
  const actionRef = useRef(primaryAction);
  actionRef.current = primaryAction;
  const starter = props.spec.content.examples?.[0]?.text ?? "";
  const files = parseWebFiles(input.text);
  const page = result?.render === "html" ? result.html : null;
  const runnable = Boolean(primaryAction) && !primaryAction?.disabled;

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!latest.current.text) onInputChange({ ...latest.current, text: starter });
  }, [onInputChange, starter]);

  // Each new page starts with an empty console.
  useEffect(() => setLines([]), [page]);

  // Only messages from our own preview frame count; the frame has an opaque origin.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { canopyConsole?: boolean; level?: unknown; text?: unknown } | null;
      if (event.source !== frame.current?.contentWindow || !data?.canopyConsole) return;
      setLines((current) => [...current, { level: String(data.level), text: String(data.text) }].slice(-500));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const run = () => {
    const action = actionRef.current;
    if (action && !action.disabled && !action.running) action.onRun();
  };
  useEffect(() => {
    onToolbarActionsChange?.({
      primaryActionInWorkspace: true,
      before: (
        <Button disabled={!runnable} onClick={run} size="xs" type="button">
          {props.spec.trigger.mode === "manual" ? props.spec.trigger.actionLabel : "Run"}
        </Button>
      ),
    });
    return () => onToolbarActionsChange?.(null);
  }, [onToolbarActionsChange, props.spec.trigger, runnable]);

  const current = FILES.find((entry) => entry.key === file) ?? FILES[0];

  const upload = async (picked: File) => {
    if (picked.size > MAX_FILE_BYTES) {
      toast.error(t("workspace.uploadTooLarge", { name: picked.name, max: MAX_FILE_BYTES / 1024 }));
      return;
    }
    try {
      const loaded = await readTextFileForEditor(picked, {
        maxEditableBytes: MAX_FILE_BYTES,
        maxLength: MAX_FILE_BYTES,
      });
      onInputChange({
        ...latest.current,
        text: stringifyWebFiles({ ...parseWebFiles(latest.current.text), [file]: loaded.text }),
      });
    } catch {
      toast.error(t("workspace.uploadFailed", { name: picked.name }));
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        run();
      }}
    >
      <input
        accept={`.${current.name.split(".").pop()},text/plain`}
        className="sr-only"
        onChange={(event) => {
          const picked = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (picked) void upload(picked);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
      <SplitStack className="min-h-0 flex-1" defaultSize={50} minSize={30} presentation>
        <WorkspaceSurface
          actions={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton action="upload" iconOnly onClick={() => fileInput.current?.click()} type="button">
                    {t("workspace.upload", { file: current.name })}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{t("workspace.upload", { file: current.name })}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton
                    action="download"
                    disabled={!files[file]}
                    iconOnly
                    onClick={() => downloadResultContent(files[file], "text/plain", current.name)}
                    type="button"
                  >
                    {t("workspace.downloadFile", { file: current.name })}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{t("workspace.downloadFile", { file: current.name })}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          className="h-full"
          purpose="editor"
          title={
            <Tabs onValueChange={(value) => setFile(value as keyof WebFiles)} value={file}>
              <TabsList className="h-[50px] gap-0 border-b-0 normal-case tracking-normal">
                {FILES.map((entry) => (
                  <TabsTrigger
                    className="h-full py-0 first:pl-0 group-data-[orientation=horizontal]/tabs:after:!bottom-0"
                    key={entry.key}
                    value={entry.key}
                  >
                    {entry.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        >
          <CodeEditor
            aria-label={t("workspace.editor", { file: current.name })}
            className="h-full"
            ide
            key={current.key}
            language={current.language}
            onChange={(text) =>
              onInputChange({ ...latest.current, text: stringifyWebFiles({ ...files, [file]: text }) })
            }
            showLineNumbers
            value={files[file]}
          />
        </WorkspaceSurface>
        <SplitStack className="min-h-0 flex-1" defaultSize={65} minSize={25} orientation="vertical">
          <WorkspaceSurface
            actions={
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToolActionButton
                      action="download"
                      disabled={!page}
                      iconOnly
                      onClick={() => page && downloadResultContent(page, "text/html", "index.html")}
                      type="button"
                    >
                      {t("workspace.download")}
                    </ToolActionButton>
                  </TooltipTrigger>
                  <TooltipContent>{t("workspace.download")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
            className="h-full"
            purpose="result"
            title={t("workspace.preview")}
          >
            {page ? (
              <iframe
                className="h-full w-full flex-1 bg-white"
                ref={frame}
                sandbox="allow-scripts allow-modals allow-forms allow-popups"
                srcDoc={page}
                title={t("workspace.previewFrame")}
              />
            ) : (
              <Muted className="px-4 py-3">{t("workspace.previewEmpty")}</Muted>
            )}
          </WorkspaceSurface>
          <WorkspaceSurface
            actions={
              <Button
                aria-label={t("workspace.consoleClear")}
                disabled={lines.length === 0}
                onClick={() => setLines([])}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            }
            className="h-full"
            meta={<Muted>{t("workspace.consoleCount", { count: lines.length })}</Muted>}
            purpose="source"
            title={t("workspace.console")}
          >
            <div aria-live="polite" className="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-sm" role="log">
              {lines.length === 0 ? (
                <Muted>{t("workspace.consoleEmpty")}</Muted>
              ) : (
                lines.map((line, index) => (
                  <div
                    className={
                      line.level === "error" ? "text-destructive" : line.level === "warn" ? "text-warning" : ""
                    }
                    key={index}
                  >
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </WorkspaceSurface>
        </SplitStack>
      </SplitStack>
    </div>
  );
}
