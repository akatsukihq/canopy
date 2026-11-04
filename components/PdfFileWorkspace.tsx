"use client";

import { useTranslations } from "next-intl";
import { ToolError, translateToolError } from "@/lib/tool-framework/run";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Caption,
  FileChip,
  FileQueueItem,
  MediaPreview,
  Muted,
  P,
  PdfViewer,
  ToolOptionsPanel,
  ToolActionButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkspacePanelHeader,
} from "@/components/ui/index.tsx";
import { Check, FileText, Upload, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { ArtifactDownloadButton } from "@/components/ArtifactDownloadButton";
import { validateFileSelection, workspaceFileId } from "@/components/FileInput";
import { PdfPreviewPage, usePdfPageImages, type PdfPageImage } from "@/components/PdfPagesSurface";
import { SettingsPanel } from "@/components/SettingsPanel";
import { FileIntakeSurface, WorkspaceSurface } from "@/components/Surfaces";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import { useToolRun } from "@/lib/tool-framework/useToolRun";
import { createToolRunFile } from "@/lib/tool-framework/workerProtocol";

export function PdfPageSelectionOverlay({
  pageNumber,
  selected,
  disabled,
  onToggle,
}: {
  pageNumber: number;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("Workbench");
  return (
    <Button
      aria-label={t("mediaTogglePage", { selected: selected ? "yes" : "no", page: pageNumber })}
      aria-pressed={selected}
      className={`absolute inset-0 h-full w-full cursor-pointer touch-pan-y rounded-lg p-0 hover:bg-transparent ${selected ? "border-2 border-primary" : "border border-border hover:border-primary/50"}`}
      disabled={disabled}
      onClick={onToggle}
      variant="card-action"
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-[4px] bg-primary text-primary-foreground"
        >
          <Check className="size-[13px]" />
        </span>
      )}
    </Button>
  );
}

export function PdfFileWorkspace({
  definitionKey,
  optionsTitle,
  getPlan,
  getPageRotation,
  pageClassName,
  renderPageOverlay,
  renderOptions,
  completedPreview,
  completionActions,
  secondaryActions,
  resultVariant = "card",
  ...props
}: WorkspaceProps & {
  definitionKey: string;
  optionsTitle: string;
  pageClassName?: string;
  getPlan: (
    settings: WorkspaceProps["settings"],
    pageCount: number,
    pages: readonly PdfPageImage[],
  ) => { title: string; detail: ReactNode };
  getPageRotation?: (page: PdfPageImage, pages: readonly PdfPageImage[]) => 0 | 90 | 180 | 270;
  renderPageOverlay?: (page: PdfPageImage, pages: readonly PdfPageImage[]) => ReactNode;
  renderOptions?: (pages: readonly PdfPageImage[]) => ReactNode;
  resultVariant?: "card" | "action";
  completedPreview?: ReactNode;
  completionActions?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  const t = useTranslations("Workbench");
  const toolText = useTranslations("Tool.runtime");
  const actionLabel = props.primaryAction?.label ?? t("run");
  const file = props.input.files[0];
  const inputSpec = props.spec.input;
  const { inspect, previews, requestThumbnails, reset, state } = useToolRun(props.spec);
  const inspectedPages = usePdfPageImages(previews);
  const [inspectedFile, setInspectedFile] = useState<File>();
  const pages = inspectedFile === file ? inspectedPages : [];
  const [currentPage, setCurrentPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [inputIssue, setInputIssue] = useState("");
  const [inspectionFailure, setInspectionFailure] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInspectedFile(file);
    setCurrentPage(1);
    setExpanded(false);
    setInputIssue("");
    setInspectionFailure("");
    reset();
    if (file) {
      try {
        inspect({
          key: definitionKey,
          file: createToolRunFile(workspaceFileId(file), file),
          thumbnailWidth: 1200,
        });
      } catch {
        setInspectionFailure(t("mediaFilePdfOpenFailed"));
      }
    }
  }, [file, attempt, definitionKey, inspect, reset, t]);

  useEffect(() => {
    setCancelled(false);
  }, [file, props.settings]);
  useEffect(() => {
    if (props.running) setCancelled(false);
  }, [props.running]);

  const plan = useMemo(() => {
    if (!pages.length) return { summary: null, error: "" };
    try {
      return { summary: getPlan(props.settings, pages.length, pages), error: "" };
    } catch (error) {
      return {
        summary: null,
        error:
          error instanceof ToolError
            ? translateToolError(
                error,
                (message) => (toolText.has(message.key) ? toolText(message.key, message.values) : undefined),
                (message) => (t.has(message.key) ? t(message.key, message.values) : undefined),
              ).message
            : error instanceof Error
              ? error.message
              : t("mediaSettingsHint"),
      };
    }
  }, [getPlan, pages, props.settings, t, toolText]);

  const inspectionError =
    inspectionFailure ||
    (state.error
      ? translateToolError(
          new ToolError(state.error.code, state.error.message, state.error.recovery, state.error.details),
          (message) => (toolText.has(message.key) ? toolText(message.key, message.values) : undefined),
          (message) => (t.has(message.key) ? t(message.key, message.values) : undefined),
        ).message
      : undefined);
  const reason = !file
    ? t("mediaAddPdf")
    : inspectionError
      ? t("mediaReplacePdfHint")
      : !pages.length
        ? t("mediaOpeningYourPdf")
        : plan.error || null;
  useEffect(() => {
    props.onValidationChange?.(reason);
  }, [reason, props.onValidationChange]);
  useEffect(() => {
    props.onToolbarActionsChange?.({
      primaryActionInWorkspace: true,
      statusMeta: file
        ? `${file.name} · ${inspectionError ? t("mediaOpenPdfFailed") : pages.length ? t("mediaPageCount", { count: pages.length }) : t("mediaOpeningPdfShort")}`
        : t("mediaAddOnePdf"),
    });
    return () => props.onToolbarActionsChange?.(null);
  }, [file, pages.length, inspectionError, props.onToolbarActionsChange, t]);

  if (inputSpec.kind !== "files") return null;
  const addFiles = (files: File[]) => {
    if (props.disabled) return;
    if (files.length !== 1) {
      setInputIssue(t("mediaOnePdfOnly"));
      return;
    }
    const selection = validateFileSelection([], files, inputSpec, (key, values) => t(key, values));
    setInputIssue(selection.issue);
    if (selection.files.length) props.onInputChange({ ...props.input, files: selection.files });
  };
  const fileChip = file ? (
    <FileChip
      file={file}
      disabled={props.disabled}
      details={pages.length ? t("mediaPageCount", { count: pages.length }) : undefined}
      onRemove={() => {
        if (props.disabled) return;
        setExpanded(false);
        props.onInputChange({ ...props.input, files: [] });
      }}
    />
  ) : undefined;
  const fileControls = (
    <ToolActionButton
      action="upload"
      disabled={props.disabled}
      onClick={() => {
        setExpanded(false);
        fileInput.current?.click();
      }}
    >
      {t("upload")}
    </ToolActionButton>
  );
  const removeFileControl = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={props.disabled ? 0 : undefined}
            aria-label={props.disabled ? t("mediaRemovePdfWait") : undefined}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Button
              aria-label={t("removeFile", { name: file?.name ?? "" })}
              disabled={props.disabled}
              onClick={() => {
                if (props.disabled) return;
                setExpanded(false);
                props.onInputChange({ ...props.input, files: [] });
              }}
              size="icon-xs"
              variant="outline"
            >
              <X aria-hidden="true" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{props.disabled ? t("mediaWaitProcessing") : t("mediaRemovePdf")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  const viewer = (fullScreen: boolean) => (
    <PdfViewer
      className="h-full min-h-0 w-full"
      currentPage={currentPage}
      fileName={file?.name ?? t("mediaSourcePdf")}
      fileSize={
        file
          ? `${(file.size / (file.size < 1_048_576 ? 1024 : 1_048_576)).toFixed(2)} ${file.size < 1_048_576 ? "KiB" : "MiB"}`
          : undefined
      }
      fit="page"
      onExpand={fullScreen ? undefined : () => setExpanded(true)}
      onPageChange={setCurrentPage}
      outline={pages.map((page) => ({
        id: `page-${page.pageNumber}`,
        title: t("mediaPageNumber", { page: page.pageNumber }),
        page: page.pageNumber,
      }))}
      pageCount={pages.length}
      pageClassName={pageClassName}
      pages={pages.map((page) => {
        const rotation = getPageRotation?.(page, pages) ?? 0;
        const swapped = rotation === 90 || rotation === 270;
        return {
          pageNumber: page.pageNumber,
          width: swapped ? page.pageHeight : page.pageWidth,
          height: swapped ? page.pageWidth : page.pageHeight,
          content: (
            <div className="relative h-full w-full overflow-hidden">
              <div
                className="absolute left-1/2 top-1/2"
                style={{
                  width: `${(swapped ? page.pageWidth / page.pageHeight : 1) * 100}%`,
                  height: `${(swapped ? page.pageHeight / page.pageWidth : 1) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              >
                <PdfPreviewPage page={page} requestThumbnails={requestThumbnails} active={fullScreen || !expanded} />
              </div>
              {renderPageOverlay?.(page, pages)}
            </div>
          ),
        };
      })}
      pagePreviewDetail={getPageRotation ? t("mediaOriginalThumbnail") : t("mediaOriginalPdfUnchanged")}
      rightChildren={
        <>
          {removeFileControl}
          {fullScreen ? (
            <Button
              disabled={props.disabled}
              onClick={() => {
                setExpanded(false);
                fileInput.current?.click();
              }}
              size="sm"
              variant="outline"
            >
              {t("mediaReplacePdf")}
            </Button>
          ) : (
            fileControls
          )}
        </>
      }
      renderPagePreview={(number) => {
        const page = pages[number - 1];
        return page ? (
          <div className="relative h-full w-full">
            <PdfPreviewPage page={page} requestThumbnails={requestThumbnails} active />
          </div>
        ) : null;
      }}
    />
  );
  const outputs = props.result?.render === "files" ? props.result.files : [];
  const primaryOutput =
    outputs.find((output) => output.mime === "application/zip") ?? (outputs.length === 1 ? outputs[0] : undefined);
  const pdfCount = outputs.filter((output) => output.mime === "application/pdf").length;
  const canDownload = outputs.length > 0 && !props.running;
  const outputReady = canDownload && !props.error && !cancelled;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,32%)] lg:overflow-hidden">
      <div
        className="flex min-h-0 min-w-0 shrink-0 flex-col border-b border-border lg:border-r lg:border-b-0"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (file) addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {file ? (
          <WorkspaceSurface
            title={t("mediaSourcePdf")}
            header="sr-only"
            className="h-[28rem] flex-none lg:h-auto lg:flex-1"
            contentClassName="gap-0"
            scroll="none"
          >
            <input
              accept={inputSpec.accept}
              className="sr-only"
              disabled={props.disabled}
              onChange={(event) => {
                if (event.target.files?.length) addFiles(Array.from(event.target.files));
                event.target.value = "";
              }}
              ref={fileInput}
              tabIndex={-1}
              type="file"
            />
            {(inspectionError || !pages.length) && (
              <WorkspacePanelHeader aria-label={t("mediaSourcePdf")} actions={fileControls}>
                {fileChip}
              </WorkspacePanelHeader>
            )}
            <WorkspaceSurface
              title={t("mediaPdfPreview")}
              header="sr-only"
              className="min-h-0 flex-1"
              scroll="none"
              contentClassName="gap-0"
              state={inspectionError ? "error" : pages.length ? "ready" : "loading"}
              stateTitle={inspectionError ? t("mediaOpenPdfFailed") : t("mediaOpeningYourPdf")}
              stateDescription={inspectionError ? t("mediaPdfRetryError", { error: inspectionError }) : undefined}
              stateAction={
                inspectionError ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => setAttempt((value) => value + 1)} variant="outline">
                      {t("mediaRetryPreview")}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {completedPreview ?? viewer(false)}
            </WorkspaceSurface>
          </WorkspaceSurface>
        ) : (
          <FileIntakeSurface
            accept={inputSpec.accept}
            className="min-h-72 flex-1"
            disabled={props.disabled}
            intakeDescription={t("mediaPdfLimits", { limit: (inputSpec.maxBytes ?? 52_428_800) / 1_048_576 })}
            intakeIcon={<Upload aria-hidden="true" />}
            intakeHint={t("mediaClickToBrowseOrDropAPdf")}
            intakeTitle={inputSpec.label}
            maxFiles={Number.MAX_SAFE_INTEGER}
            onFiles={addFiles}
            title={t("mediaSourcePdf")}
          />
        )}
        {inputIssue && (
          <Alert className="mx-4 mb-3 w-auto" variant="destructive">
            <AlertTitle>{t("mediaPdfNotAdded")}</AlertTitle>
            <AlertDescription>{inputIssue}</AlertDescription>
          </Alert>
        )}
        {!file && (
          <Caption className="shrink-0 px-4 pb-4 text-muted-foreground">
            {t("mediaPasswordProtectedPdfsAreNotSupportedRemove")}
          </Caption>
        )}
      </div>
      <ToolOptionsPanel
        aria-label={optionsTitle}
        className="min-h-0 shrink-0 p-5 lg:overflow-y-auto max-sm:[&_[data-slot=button]]:!min-h-11 [@media(pointer:coarse)]:[&_[data-slot=button]]:!min-h-11"
        title={optionsTitle}
        variant="plain"
      >
        {renderOptions ? (
          renderOptions(pages)
        ) : (
          <SettingsPanel
            disabled={props.disabled}
            onChange={props.onSettingChange}
            spec={props.spec.settings}
            values={props.settings}
          />
        )}
        {plan.error && (
          <Alert variant="destructive">
            <AlertTitle>{t("mediaCheckYourSettings")}</AlertTitle>
            <AlertDescription>{plan.error}</AlertDescription>
          </Alert>
        )}
        {(!(primaryOutput && completionActions) || props.running || props.error || cancelled) && (
          <Button
            className="w-full"
            disabled={props.running || Boolean(reason) || props.primaryAction?.disabled}
            loading={props.running}
            onClick={props.primaryAction?.onRun}
          >
            {actionLabel}
          </Button>
        )}
        <WorkspaceSurface
          title={t("mediaProcessedOutput")}
          purpose="result"
          variant="card"
          className="shrink-0"
          contentClassName="gap-3 px-4 pb-4 pt-2"
          aria-busy={props.running}
          actions={
            primaryOutput ? (
              <ArtifactDownloadButton
                file={primaryOutput}
                disabled={!canDownload}
                variant="toolbar"
                label={
                  primaryOutput.mime === "application/zip"
                    ? t("mediaDownloadZip")
                    : resultVariant === "action" && primaryOutput.mime === "application/pdf"
                      ? t("mediaDownloadPdf")
                      : undefined
                }
              />
            ) : outputs.length === 0 ? (
              <ToolActionButton action="download" disabled />
            ) : undefined
          }
        >
          <div className="flex min-h-24 flex-col justify-center gap-2" role={props.error ? "alert" : "status"}>
            {props.running ? (
              <>
                <P>{props.spec.labels.running}</P>
                <Muted>{props.progress?.stage ?? t("mediaPreparingDocument")}</Muted>
                {props.primaryAction?.onCancel && (
                  <Button
                    className="self-start"
                    onClick={() => {
                      setCancelled(true);
                      props.primaryAction?.onCancel?.();
                    }}
                    variant="secondary"
                  >
                    {t("cancel")}
                  </Button>
                )}
              </>
            ) : props.error ? (
              <>
                <P className="text-destructive">{t("mediaActionFailed", { action: actionLabel })}</P>
                <Muted>{t("mediaPdfActionRetry", { error: props.error })}</Muted>
              </>
            ) : cancelled ? (
              <>
                <P>{t("mediaProcessingCancelled")}</P>
                <Muted>{t("mediaPdfKeptRetry", { action: actionLabel })}</Muted>
              </>
            ) : outputReady ? (
              <>
                <P>{pdfCount > 1 ? t("mediaPdfsReady", { count: pdfCount }) : t("mediaDownloadReady")}</P>
                {primaryOutput && (
                  <Muted className="break-words">
                    {primaryOutput.name} · {(primaryOutput.size / 1024).toFixed(1)} KiB
                  </Muted>
                )}
                <Muted>{t("mediaYourOriginalPdfIsUnchanged")}</Muted>
              </>
            ) : !reason && plan.summary ? (
              <>
                <P>{plan.summary.title}</P>
                <div className="text-sm text-muted-foreground">{plan.summary.detail}</div>
                <Muted>{t("mediaCreateProcessed", { action: actionLabel })}</Muted>
              </>
            ) : (
              <Muted>{t("mediaProcessedHint", { reason: plan.error ? t("mediaCheckAbove") : (reason ?? "") })}</Muted>
            )}
            {canDownload && (props.error || cancelled) && (
              <>
                <Muted>{t("mediaYourPreviousOutputIsStillAvailableTo")}</Muted>
                {primaryOutput && (
                  <Muted className="break-words">
                    {primaryOutput.name} · {(primaryOutput.size / 1024).toFixed(1)} KiB
                  </Muted>
                )}
              </>
            )}
          </div>
          {canDownload && outputs.some((output) => output !== primaryOutput) && (
            <section
              aria-label={t("mediaNamedResults", { name: props.spec.name })}
              className="grid min-w-0 border-t border-border"
            >
              {outputs
                .filter((output) => output !== primaryOutput)
                .map((output) => (
                  <FileQueueItem
                    className="flex-wrap bg-transparent"
                    key={output.id}
                    icon={<FileText aria-hidden="true" />}
                    name={output.name}
                    metadata={`${output.mime === "application/zip" ? t("mediaZipArchive") : "PDF"} · ${(output.size / 1024).toFixed(1)} KiB`}
                    action={<ArtifactDownloadButton file={output} variant="toolbar" />}
                  />
                ))}
            </section>
          )}
        </WorkspaceSurface>
        {canDownload && primaryOutput ? completionActions : secondaryActions}
      </ToolOptionsPanel>
      <MediaPreview
        open={expanded}
        onOpenChange={setExpanded}
        title={file?.name ?? t("mediaSourcePdf")}
        description={t("mediaOriginalPdfPosition", { page: currentPage, count: pages.length })}
        viewportClassName="bg-card p-0 text-foreground sm:p-0"
      >
        {viewer(true)}
      </MediaPreview>
    </div>
  );
}
