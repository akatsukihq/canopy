"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { CodeEditor } from "@/components/content/CodeEditor";
import { downloadResultContent, ResultActions, ResultView } from "@/components/ResultView";
import { ResultSurface } from "@/components/ResultSurface";
import { SplitStack } from "@/components/Stacks";
import { WorkspaceSurface } from "@/components/Surfaces";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import { SourceTextarea } from "@/components/WorkspaceInput";
import {
  Button,
  Muted,
  Select,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  ToolActionButton,
  toast,
} from "@/components/ui/index.tsx";
import { browserDraftStorage, loadDraft, saveDraft } from "@/lib/code-execution/draft";
import { getCodeLanguage, type CodeLanguage } from "@/lib/code-execution/languages";
import { MAX_SOURCE_BYTES } from "@/lib/code-execution/validate";
import { readTextFileForEditor } from "@/lib/tool-framework/textFileInput";

const DRAFT_SAVE_DELAY_MS = 400;
const SHORTCUT = "Ctrl/Cmd+Enter";

/** One workspace for every `tools/*-compiler` page; the registry entry is its only configuration. */
export function CodeRunnerWorkspace(props: WorkspaceProps) {
  const language = getCodeLanguage(props.spec.toolId.split(".")[1] ?? "");
  return language ? <CodeRunner {...props} language={language} /> : null;
}

function CodeRunner({ language, ...props }: WorkspaceProps & { language: CodeLanguage }) {
  const t = useTranslations("Tool.runtime");
  const { input, onInputChange, onSettingChange, primaryAction, onToolbarActionsChange } = props;
  const key = language.definitionKey;
  const [cancelled, setCancelled] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(input);
  latest.current = input;
  const running = primaryAction?.running ?? false;
  const actionRef = useRef(primaryAction);
  actionRef.current = primaryAction;

  // First paint: restore this browser's draft, otherwise the starter program.
  const seededOnce = useRef(false);
  useEffect(() => {
    if (seededOnce.current) return;
    seededOnce.current = true;
    if (latest.current.text === "") {
      onInputChange({ ...latest.current, text: loadDraft(browserDraftStorage(), key) ?? language.starter });
    }
    setSeeded(true);
  }, [key, language.starter, onInputChange]);

  useEffect(() => {
    if (!seeded) return;
    const timer = window.setTimeout(
      () => saveDraft(browserDraftStorage(), key, input.text, language.starter),
      DRAFT_SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [input.text, key, language.starter, seeded]);

  useEffect(() => {
    if (running) setCancelled(false);
  }, [running]);

  const setText = (text: string) => {
    setCancelled(false);
    onInputChange({ ...latest.current, files: [], text });
  };

  const run = () => {
    const action = actionRef.current;
    if (action && !action.disabled && !action.running) action.onRun();
  };
  const cancel = () => {
    setCancelled(true);
    actionRef.current?.onCancel?.();
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  const upload = async (file: File) => {
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error(t("codeRunner.uploadTooLarge", { name: file.name, max: MAX_SOURCE_BYTES / 1024 }));
      return;
    }
    try {
      const loaded = await readTextFileForEditor(file, {
        maxEditableBytes: MAX_SOURCE_BYTES,
        maxLength: MAX_SOURCE_BYTES,
      });
      setText(loaded.text);
    } catch {
      toast.error(t("codeRunner.uploadFailed", { name: file.name }));
    }
  };

  const verdict = props.result?.verdict;
  const announcement = running
    ? t("codeRunner.running")
    : cancelled
      ? t("codeRunner.cancelled")
      : verdict
        ? verdict.labelMessage && t.has(verdict.labelMessage.key)
          ? t(verdict.labelMessage.key, verdict.labelMessage.values)
          : verdict.label
        : "";
  const versionLabel = t("codeRunner.version", { language: props.spec.name.replace(/ Compiler$/, "") });
  const selectedVersion = typeof props.settings.version === "string" ? props.settings.version : language.versionId;
  const blocked = primaryAction?.disabled && !running;

  // Run lives in the page's own top bar, beside Example and Reset.
  const runnable = Boolean(primaryAction) && !primaryAction?.disabled;
  const hasSource = input.text !== "";
  const verdictLine =
    !running && props.result?.verdict?.level === "ok"
      ? `${props.result.verdict.label} ${props.result.verdict.detail ?? ""}`.trim()
      : undefined;
  useEffect(() => {
    onToolbarActionsChange?.({
      primaryActionInWorkspace: true,
      status: verdictLine,
      before: (
        <TooltipProvider>
          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-busy="true" onClick={cancel} size="xs" type="button" variant="outline">
                  {t("codeRunner.cancel")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("codeRunner.cancelTooltip")}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={runnable ? undefined : 0}>
                  <Button disabled={!runnable} onClick={run} size="xs" type="button">
                    {t("codeRunner.run")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("codeRunner.runTooltip", { shortcut: SHORTCUT })}</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      ),
    });
    return () => onToolbarActionsChange?.(null);
    // run/cancel read the latest primaryAction through a ref, so only its visible state re-renders the bar.
  }, [onToolbarActionsChange, running, runnable, t, verdictLine]);

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDownCapture={onKeyDownCapture}>
      <input
        accept={`.${language.fileName.split(".").pop()},text/plain`}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
      <SplitStack className="min-h-0 flex-1" defaultSize={60} minSize={35} presentation>
        <WorkspaceSurface
          actions={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton
                    action="upload"
                    disabled={running}
                    iconOnly
                    onClick={() => fileInput.current?.click()}
                    type="button"
                  >
                    {t("codeRunner.upload")}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{t("codeRunner.upload")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolActionButton
                    action="download"
                    disabled={!hasSource}
                    iconOnly
                    onClick={() => downloadResultContent(input.text, "text/plain", language.fileName)}
                    type="button"
                  >
                    {t("codeRunner.download")}
                  </ToolActionButton>
                </TooltipTrigger>
                <TooltipContent>{`${t("codeRunner.download")} (${language.fileName})`}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          className="h-full"
          meta={
            <div className="flex items-center gap-2">
              <Muted>{language.fileName}</Muted>
              <Select
                aria-label={versionLabel}
                className="w-auto"
                disabled={running || language.versions.length < 2}
                onChange={(event) => onSettingChange("version", event.currentTarget.value)}
                size="xs"
                value={selectedVersion}
              >
                {language.versions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
          }
          purpose="editor"
          title={t("codeRunner.editor", { language: language.language })}
        >
          <CodeEditor
            aria-label={t("codeRunner.editor", { language: language.language })}
            className="h-full"
            ide
            language={language.editorLanguage}
            maxLength={MAX_SOURCE_BYTES}
            onChange={setText}
            showLineNumbers
            value={input.text}
          />
        </WorkspaceSurface>
        <div className="flex h-full min-h-0 flex-col">
          {blocked && input.text.trim() === "" ? (
            <Muted className="px-4 py-2" role="status">
              {t("codeRun.source.required")}
            </Muted>
          ) : cancelled ? (
            <Muted className="px-4 py-2">{t("codeRunner.cancelled")}</Muted>
          ) : null}
          <SplitStack className="min-h-0 flex-1" defaultSize={65} minSize={25} orientation="vertical">
            <ResultSurface
              error={props.error}
              renderResult={(result) => <ResultView hideStats result={{ ...result, verdict: undefined }} />}
              renderResultActions={(result) => {
                const stats = (result.stats ?? []).map((stat) => ({
                  label: stat.labelMessage && t.has(stat.labelMessage.key) ? t(stat.labelMessage.key) : stat.label,
                  value:
                    stat.valueMessage && t.has(stat.valueMessage.key)
                      ? t(stat.valueMessage.key, stat.valueMessage.values)
                      : stat.value,
                }));
                return (
                  <>
                    {stats.length ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              aria-label={stats.map((stat) => `${stat.label}: ${stat.value}`).join(", ")}
                              className="text-muted-foreground"
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <Info aria-hidden="true" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                              {stats.map((stat) => (
                                <div className="contents" key={stat.label}>
                                  <dt className="opacity-80">{stat.label}</dt>
                                  <dd className="text-right font-medium">{stat.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : null}
                    <ResultActions canCopy canDownload result={result} />
                  </>
                );
              }}
              result={props.result}
              running={props.running}
              spec={props.spec}
              title={props.spec.labels.result}
            />
            <WorkspaceSurface
              className="h-full"
              description={t("codeRunner.stdinHelp")}
              purpose="source"
              title={t("codeRunner.stdin")}
            >
              <SourceTextarea
                aria-label={t("codeRunner.stdin")}
                className="min-h-0 flex-1"
                id={`${key}-stdin`}
                maxLength={MAX_SOURCE_BYTES}
                onChange={(secondary) => onInputChange({ ...latest.current, secondary })}
                placeholder={t("codeRunner.stdinPlaceholder")}
                value={input.secondary ?? ""}
              />
            </WorkspaceSurface>
          </SplitStack>
        </div>
      </SplitStack>
    </div>
  );
}

export default CodeRunnerWorkspace;
