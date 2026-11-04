"use client";

import { useTranslations } from "next-intl";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Caption,
  ContentState,
  Muted,
  ProcessingStatus,
  ToolOptionsPanel,
  FieldLabel,
  Select,
  ToolActionButton,
  toast,
} from "@/components/ui/index.tsx";
import { ShieldCheck, Upload } from "lucide-react";

import { IMAGE_OUTPUT_KEY, resolveImageConversion } from "@/app/media/lib/imageConversion";
import { ArtifactDownloadButton } from "@/components/ArtifactDownloadButton";
import { SettingsStack, SplitStack } from "@/components/Stacks";
import { validateFileSelection } from "@/components/FileInput";
import { MediaInputGallery, MediaOutputGallery } from "@/components/MediaOutputGallery";
import { SettingsPanel } from "@/components/SettingsPanel";
import { FileIntakeSurface, WorkspaceSurface } from "@/components/Surfaces";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import type { SettingsSpec } from "@/lib/tool-framework/settings";

function sizeLabel(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

/** Shared operation surface for image-to-image conversions, driven by the tool's own contract. */
export function ImageConversionWorkspace(props: WorkspaceProps) {
  const t = useTranslations("Workbench");
  const toolText = useTranslations("Tool.runtime");
  const outputFormatId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const pasteRequest = useRef(0);
  const [pastePending, setPastePending] = useState(false);
  const [inputIssue, setInputIssue] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputSpec = props.spec.input;
  const running = Boolean(props.running);
  const disabled = Boolean(props.disabled || running);
  const hasFiles = props.input.files.length > 0;
  const conversion = resolveImageConversion(props.spec, props.settings, props.conversions);
  const activeSpec = conversion.spec;
  const alternateTarget = activeSpec.toolId !== props.spec.toolId;
  const formatName = conversion.target === "webp" ? "WebP" : conversion.target.toUpperCase();
  const actionLabel = alternateTarget
    ? toolText("conversion.action", { format: formatName })
    : activeSpec.trigger.mode === "manual"
      ? activeSpec.trigger.actionLabel
      : t("mediaConvertImages");
  const runningLabel = alternateTarget
    ? toolText("conversion.running", { format: formatName })
    : activeSpec.labels.running;
  const outputFormat = conversion.target.toUpperCase();
  const outputImages = useMemo(
    () => (props.result?.render === "files" ? props.result.files.filter((file) => file.mime.startsWith("image/")) : []),
    [props.result],
  );
  const completed = outputImages.length > 0;
  const completedFormat = outputImages[0]?.mime.split("/")[1]?.replace("jpeg", "jpg").toUpperCase();
  const primaryOutput =
    props.result?.render === "files"
      ? (props.result.files.find((file) => file.mime === "application/zip") ?? outputImages[0])
      : undefined;
  const settingsSpec = useMemo<SettingsSpec>(
    () => ({
      ...activeSpec.settings,
      fields: Object.fromEntries(
        Object.entries(activeSpec.settings.fields).map(([key, field]) => {
          const adapted =
            field.kind === "slider" ? { ...field, kind: "number" as const, step: field.step ?? 1 } : field;
          return [
            key,
            {
              ...adapted,
              ...(alternateTarget && key === "quality"
                ? {
                    label: toolText("conversion.qualityLabel"),
                    help: toolText("conversion.qualityHelp", { format: conversion.target }),
                  }
                : {}),
              ...(alternateTarget && key === "background"
                ? { label: toolText("conversion.backgroundLabel"), help: toolText("conversion.backgroundHelp") }
                : {}),
            },
          ];
        }),
      ),
    }),
    [activeSpec.settings, alternateTarget, conversion.target, toolText],
  );
  let settingsIssue = "";
  for (const [key, field] of Object.entries(settingsSpec.fields)) {
    const raw = conversion.settings[key] ?? field.default;
    if (field.kind === "number") {
      const value = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
      if (
        raw === "" ||
        !Number.isFinite(value) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      ) {
        settingsIssue = t("mediaNumberRange", { label: field.label, min: field.min ?? 0, max: field.max ?? 100 });
        break;
      }
    } else if (field.kind === "color" && (typeof raw !== "string" || !/^#[0-9a-f]{6}$/i.test(raw))) {
      settingsIssue = t("mediaHexColor", { label: field.label });
      break;
    }
  }
  const reason = settingsIssue || (!hasFiles ? t("mediaAddImage") : null);
  useEffect(() => {
    props.onValidationChange?.(reason);
  }, [reason, props.onValidationChange]);
  const onCancel = props.primaryAction?.onCancel;
  const cancelConversion = useCallback(() => {
    setCancelled(true);
    onCancel?.();
  }, [onCancel]);
  useEffect(() => {
    props.onToolbarActionsChange?.({
      primaryActionLabel: actionLabel,
      onCancel: onCancel ? cancelConversion : undefined,
    });
    return () => props.onToolbarActionsChange?.(null);
  }, [actionLabel, cancelConversion, onCancel, props.onToolbarActionsChange]);
  useEffect(() => {
    setCancelled(false);
  }, [props.input, props.settings]);
  useEffect(() => {
    if (running) setCancelled(false);
  }, [running]);
  useEffect(
    () => () => {
      pasteRequest.current += 1;
    },
    [props.input, disabled],
  );

  if (inputSpec.kind !== "files") return null;
  const addFiles = (files: File[]) => {
    if (disabled || files.length === 0) return;
    const selection = validateFileSelection(props.input.files, files, inputSpec, (key, values) => t(key, values));
    setInputIssue(selection.issue);
    if (selection.files.length !== props.input.files.length)
      props.onInputChange({ ...props.input, files: selection.files });
  };
  const pasteImages = async () => {
    if (disabled || pastePending) return;
    if (typeof navigator.clipboard?.read !== "function") {
      toast.error(t("mediaClipboardUnavailable"));
      return;
    }
    const request = ++pasteRequest.current;
    setPastePending(true);
    try {
      const items = await navigator.clipboard.read();
      const images = await Promise.all(
        items.map(async (item, index) => {
          const type = item.types.find((value) => value.startsWith("image/"));
          if (!type) return null;
          const blob = await item.getType(type);
          const extension = type === "image/jpeg" ? "jpg" : type.slice(6).split("+")[0];
          return new File([blob], `pasted-image-${props.input.files.length + index + 1}.${extension}`, { type });
        }),
      );
      if (request !== pasteRequest.current) return;
      const files = images.filter((file): file is File => file !== null);
      if (!files.length) {
        toast.error(t("mediaClipboardEmpty"));
        return;
      }
      addFiles(files);
    } catch {
      if (request === pasteRequest.current) toast.error(t("mediaClipboardReadFailed"));
    } finally {
      setPastePending(false);
    }
  };
  const convertMore = () => {
    if (disabled) return;
    setInputIssue("");
    props.onInputChange({ files: [], text: "" });
    for (const [key, field] of Object.entries(props.spec.settings.fields)) props.onSettingChange(key, field.default);
  };
  const progress =
    props.progress && props.progress.total > 0
      ? Math.min(100, Math.max(0, Math.round((props.progress.completed / props.progress.total) * 100)))
      : undefined;

  const fileActions = (
    <>
      <input
        ref={fileInput}
        accept={inputSpec.accept}
        type="file"
        multiple={inputSpec.multiple}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          if (event.currentTarget.files) addFiles(Array.from(event.currentTarget.files));
          event.currentTarget.value = "";
        }}
      />
      <ToolActionButton
        action="paste"
        disabled={disabled || pastePending}
        loading={pastePending}
        onClick={() => void pasteImages()}
      >
        {pastePending ? t("pasting") : t("paste")}
      </ToolActionButton>
      <ToolActionButton action="upload" disabled={disabled} onClick={() => fileInput.current?.click()}>
        {t("upload")}
      </ToolActionButton>
    </>
  );

  return (
    <SettingsStack className="h-full" defaultCollapsed="secondary" defaultSize={75} minSize={75}>
      <SplitStack presentation className="h-full" defaultSize={50} minSize={30}>
        <div
          className={`flex h-full min-h-0 min-w-0 flex-col max-[64rem]:h-[32rem] ${dragging ? "ring-2 ring-inset ring-primary" : ""}`}
          onPaste={(event) => {
            if (disabled || pastePending) return;
            const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (!files.length) return;
            event.preventDefault();
            addFiles(files);
          }}
          onDragOver={(event) => {
            if (disabled || !hasFiles || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(event) => {
            if (!hasFiles) return;
            event.preventDefault();
            setDragging(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {hasFiles ? (
            <WorkspaceSurface
              title={t("mediaImageSelection")}
              header="sr-only"
              purpose="source"
              className="min-h-0 flex-1"
              contentClassName="gap-0"
              scroll="none"
            >
              <MediaInputGallery
                actions={fileActions}
                files={props.input.files}
                disabled={disabled}
                onRemove={(file) => {
                  if (disabled) return;
                  setInputIssue("");
                  props.onInputChange({ ...props.input, files: props.input.files.filter((entry) => entry !== file) });
                }}
              />
            </WorkspaceSurface>
          ) : (
            <FileIntakeSurface
              actions={fileActions}
              accept={inputSpec.accept}
              multiple={inputSpec.multiple}
              maxFiles={Number.MAX_SAFE_INTEGER}
              className="min-h-0 flex-1"
              disabled={disabled}
              intakeIcon={<Upload aria-hidden="true" />}
              intakeTitle={inputSpec.label}
              intakeDescription={inputSpec.dropzoneDescription}
              onFiles={addFiles}
              title={t("mediaSelectedImages")}
              intakeHint={t("mediaClickToBrowseOrDragAndDrop")}
            />
          )}
          {inputIssue && (
            <Alert className="m-4 w-auto shrink-0" variant="destructive">
              <AlertTitle>{t("filesNotAdded")}</AlertTitle>
              <AlertDescription>{t("mediaImageSelectionRetry", { error: inputIssue })}</AlertDescription>
            </Alert>
          )}
          {!hasFiles && (
            <Caption className="flex shrink-0 items-center justify-center gap-2 px-4 pb-4 text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
              {t("mediaFilesStayOnThisDeviceNothingIs")}
            </Caption>
          )}
        </div>
        <WorkspaceSurface
          title={t("mediaProcessedOutput")}
          purpose="result"
          className="h-full max-[64rem]:h-[32rem]"
          contentClassName="gap-0 overflow-hidden"
          meta={running ? t("processing") : primaryOutput ? sizeLabel(primaryOutput.size) : undefined}
          actions={
            primaryOutput ? (
              <ArtifactDownloadButton
                file={primaryOutput}
                key={primaryOutput.id}
                disabled={running}
                label={primaryOutput.mime === "application/zip" ? t("mediaDownloadZip") : t("download")}
                variant="toolbar"
              />
            ) : (
              <ToolActionButton action="download" disabled>
                {t("download")}
              </ToolActionButton>
            )
          }
        >
          {running && (
            <div className="shrink-0 p-4">
              <ProcessingStatus
                title={runningLabel}
                progress={progress}
                detail={
                  props.progress
                    ? t("mediaCompleteProgress", {
                        stage: props.progress.stage,
                        completed: Math.min(props.progress.completed, props.progress.total),
                        count: props.progress.total,
                      })
                    : completed
                      ? t("mediaUpdatingImages")
                      : t("mediaPreparingImages")
                }
                action={
                  props.primaryAction?.onCancel ? (
                    <Button variant="secondary" onClick={cancelConversion}>
                      {t("cancel")}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
          {!running && (props.error || cancelled) && (
            <div className="shrink-0 space-y-2 p-4" role="status">
              <Muted className={props.error ? "text-destructive" : undefined}>
                {t("mediaConversionRetry", {
                  error: props.error || t("mediaConversionCancelled"),
                  completed: completed ? "yes" : "no",
                })}
              </Muted>
              <Button
                disabled={disabled || Boolean(reason) || props.primaryAction?.disabled}
                onClick={props.primaryAction?.onRun}
              >
                {t("mediaRetryConversion")}
              </Button>
            </div>
          )}
          {completed ? (
            <>
              <MediaOutputGallery
                files={outputImages}
                key={outputImages.map((file) => file.id).join(":")}
                header="sr-only"
                disabled={running}
                primaryOutputId={primaryOutput?.id}
              />
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border p-4">
                <div className="min-w-0 flex-1">
                  <Muted role="status">
                    {running
                      ? t("mediaUpdatingConverted")
                      : t("mediaImagesConverted", { count: outputImages.length, format: completedFormat ?? "" })}
                  </Muted>
                  <Caption className="text-muted-foreground">
                    {t("mediaChangingSettingsUpdatesTheOutputYourOriginals")}
                  </Caption>
                </div>
                <Button variant="outline" disabled={disabled} onClick={convertMore}>
                  {t("mediaConvertMore")}
                </Button>
              </div>
            </>
          ) : !running && !props.error && !cancelled ? (
            <ContentState
              state="waiting"
              className="min-h-0 flex-1 rounded-none border-0 bg-transparent"
              title={t("mediaConvertedImagesWillAppearHere")}
              description={t("mediaConvertInstructions", {
                action: actionLabel,
                multiple: hasFiles && props.input.files.length > 1 ? "yes" : "no",
                format: outputFormat,
              })}
            />
          ) : null}
        </WorkspaceSurface>
      </SplitStack>
      <ToolOptionsPanel
        title={t("options")}
        aria-label={t("mediaConversionSettings")}
        variant="plain"
        className="h-full overflow-y-auto p-[22px]"
      >
        {Object.keys(settingsSpec.fields).length > 0 ? (
          <SettingsPanel
            disabled={disabled}
            spec={settingsSpec}
            values={conversion.settings}
            onChange={(key, value) => props.onSettingChange(conversion.settingKey(key), value)}
          />
        ) : (
          <Muted>{t("mediaPngIsLosslessNoQualitySettingsAre")}</Muted>
        )}
        <div className="grid gap-2">
          <FieldLabel htmlFor={outputFormatId}>{t("mediaOutputFormat")}</FieldLabel>
          <Select
            id={outputFormatId}
            aria-describedby={`${outputFormatId}-help`}
            disabled={disabled}
            value={conversion.target}
            onChange={(event) => {
              const value = event.target.value;
              if (!disabled && conversion.choices.some((entry) => entry.toolId.endsWith(`-to-${value}`)))
                props.onSettingChange(IMAGE_OUTPUT_KEY, value);
            }}
          >
            {[
              { value: "jpg", label: "JPG (JPEG)" },
              { value: "png", label: "PNG" },
              { value: "webp", label: "WebP" },
            ].map((item) => (
              <option
                key={item.value}
                value={item.value}
                disabled={!conversion.choices.some((entry) => entry.toolId.endsWith(`-to-${item.value}`))}
              >
                {item.label}
              </option>
            ))}
          </Select>
          <Caption id={`${outputFormatId}-help`} className="text-muted-foreground">
            {t("mediaFormatSwitchHint", { source: conversion.source, format: conversion.source.toUpperCase() })}
          </Caption>
        </div>
        {settingsIssue && (
          <Muted className="text-destructive" role="status">
            {settingsIssue}
          </Muted>
        )}
        <Caption className="text-muted-foreground">{t("mediaOriginalPixelDimensionsArePreservedMetadataIs")}</Caption>
      </ToolOptionsPanel>
    </SettingsStack>
  );
}
