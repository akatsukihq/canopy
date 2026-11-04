"use client";

import { Overline, H3, Muted, Caption, Strong, ToolOptionsPanel } from "@/components/ui/index.tsx";
import { ArrowDownToLine, FileSpreadsheet } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { type DragEvent, type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { textInputFileIssue } from "@/components/FileInput";
import { ResultSurface, type ResultSurfaceProps } from "@/components/ResultSurface";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SettingsStack, SplitStack } from "@/components/Stacks";
import { useWorkbenchPresentation } from "@/components/ui/components/workbench-presentation";
import { WorkspaceInputSurface } from "@/components/WorkspaceInput";
import type { ToolResult } from "@/lib/tool-framework/result";
import type { ToolInputSpec, ToolLayout, ToolSpec } from "@/lib/tool-framework/spec";
import { readTextFileForEditor } from "@/lib/tool-framework/textFileInput";
import type { ToolLifecycle } from "@/lib/tool-runtime/types";

function LoadingWorkspace() {
  const t = useTranslations("Workbench");
  return (
    <Muted className="p-4" role="status">
      {t("loading")}
    </Muted>
  );
}

const ImageConversionWorkspace = dynamic(
  () => import("@/app/media/components/ImageConversionWorkspace").then((module) => module.ImageConversionWorkspace),
  { loading: LoadingWorkspace },
);
const FileProcessorWorkspace = dynamic(
  () => import("@/components/FileProcessorWorkspace").then((module) => module.FileProcessorWorkspace),
  { loading: LoadingWorkspace },
);

export interface WorkspaceInputState {
  readonly files: readonly File[];
  readonly secondary?: string;
  readonly text: string;
}

export type WorkspacePrimaryAction = {
  readonly disabled: boolean;
  readonly label: string;
  readonly onCancel?: () => void;
  readonly onRun: () => void;
  readonly running: boolean;
} | null;

export interface WorkspaceToolbarActions {
  readonly primaryActionInWorkspace?: boolean;
  readonly afterExample?: ReactNode;
  readonly before?: ReactNode;
  readonly exampleIcon?: ReactNode;
  readonly exampleLabel?: string;
  readonly exampleVariant?: "link" | "outline";
  readonly onExample?: () => void;
  readonly onCancel?: () => void;
  readonly primaryActionLabel?: string;
  readonly statusMeta?: ReactNode;
  /** Replaces the status bar text while the last run is complete. */
  readonly status?: string;
}

export interface WorkspaceProps {
  disabled?: boolean;
  error?: string;
  errorLocation?: { line: number; column: number };
  input: WorkspaceInputState;
  lifecycle: ToolLifecycle;
  onInputChange: (input: WorkspaceInputState) => void;
  onSettingChange: (key: string, value: unknown) => void;
  onToolbarActionsChange?: (actions: WorkspaceToolbarActions | null) => void;
  /**
   * Reports the tool's own pre-run readiness (`tools/<key>/hooks.ts`
   * `validate`): `null` when the job may start, otherwise the reason it may
   * not. The owner of the primary action disables it while this is non-null;
   * the workspace also shows the reason next to the settings it refers to.
   *
   * Optional so the workspaces that run no hook stay unchanged.
   */
  onValidationChange?: (reason: string | null) => void;
  primaryAction?: WorkspacePrimaryAction;
  progress?: {
    readonly completed: number;
    readonly stage: string;
    readonly total: number;
  } | null;
  result: ToolResult | null;
  running?: boolean;
  settings: Readonly<Record<string, unknown>>;
  spec: ToolSpec;
}

function getInputSplitSizes(inputSpec: ToolInputSpec, defaultSize: number, minSize: number) {
  const allSingleLineFields = inputSpec.kind === "fields" && inputSpec.fields.every((field) => !field.multiline);
  if (!allSingleLineFields) return { defaultSize, minSize };

  return inputSpec.fields.length > 1 ? { defaultSize: 36, minSize: 30 } : { defaultSize: 24, minSize: 20 };
}

function stackedResultTitle(spec: ToolSpec) {
  return spec.labels.result ?? "Result";
}

function InputResultWorkspace({
  defaultSize,
  input,
  inputSize,
  layout,
  layoutSwitchable,
  minSize,
  result,
}: {
  defaultSize: number;
  input: ReactNode;
  inputSize?: ToolSpec["inputSize"];
  layout: ToolLayout;
  layoutSwitchable: boolean;
  minSize: number;
  result: ReactNode;
}) {
  return (
    <SplitStack
      presentation
      layoutSwitchable={layoutSwitchable}
      className={layout === "stacked" ? "h-full p-5" : "h-full"}
      defaultSize={inputSize?.default ?? defaultSize}
      minSize={inputSize?.min ?? minSize}
      maxSize={inputSize?.max}
      orientation={layout === "stacked" ? "vertical" : "horizontal"}
    >
      <div className={layout === "stacked" ? "h-full pb-2.5" : "h-full"}>{input}</div>
      <div className={layout === "stacked" ? "h-full pt-2.5" : "h-full"}>{result}</div>
    </SplitStack>
  );
}

function TextFileDropTarget({ children, props }: { children: ReactNode; props: WorkspaceProps }) {
  const [dragActive, setDragActive] = useState(false);
  const [dropIssue, setDropIssue] = useState("");
  const dragDepth = useRef(0);
  const fileReadRequestRef = useRef(0);
  const acceptedFile = props.spec.input.kind === "text" ? props.spec.input.acceptFiles : undefined;
  const inputName = props.spec.input.kind === "text" ? props.spec.input.label : "file";
  const acceptedDescription =
    acceptedFile?.accept
      .split(",")
      .filter((entry) => entry.trim().startsWith("."))
      .map((entry) => entry.trim().slice(1).toUpperCase())
      .join(" or ") || "Accepted text file";

  useEffect(() => {
    fileReadRequestRef.current += 1;
    setDropIssue("");
  }, [props.input.files, props.input.text]);

  if (!acceptedFile) return children;

  const hasFiles = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.types).includes("Files");
  const resetDrag = () => {
    dragDepth.current = 0;
    setDragActive(false);
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event) || props.disabled) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
    setDropIssue("");
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event) || props.disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event) || props.disabled) return;
    event.preventDefault();
    resetDrag();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const issue = textInputFileIssue(file, acceptedFile);
    if (issue) {
      setDropIssue(issue);
      return;
    }
    try {
      const request = ++fileReadRequestRef.current;
      const loaded = await readTextFileForEditor(file, {
        maxEditableBytes: acceptedFile.maxEditableBytes,
        maxLength: props.spec.input.kind === "text" ? props.spec.input.maxLength : undefined,
      });
      if (request !== fileReadRequestRef.current) return;
      setDropIssue("");
      props.onInputChange({
        ...props.input,
        files: [file],
        text: loaded.text,
      });
    } catch {
      setDropIssue(`${file.name} could not be read.`);
    }
  };

  return (
    <div
      className="relative h-full min-h-0"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(event) => void onDrop(event)}
    >
      {children}
      {dropIssue ? (
        <div
          className="absolute top-3 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-2 text-destructive shadow-sm"
          role="alert"
        >
          <Caption>{dropIssue}</Caption>
        </div>
      ) : null}
      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center overflow-hidden rounded-xl border-2 border-primary bg-accent/95">
          <Overline className="absolute top-4 left-4 rounded-full bg-primary px-3 py-1.5 text-primary-foreground">
            DROP MODE ACTIVE
          </Overline>
          <div className="grid max-w-xl justify-items-center gap-4 px-8 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <ArrowDownToLine aria-hidden="true" className="size-7" />
            </span>
            <div>
              <H3>Release to replace the current {inputName.toLowerCase()}</H3>
              <Muted className="mt-2 text-muted-foreground">
                Drop anywhere in this workbench. The file stays on this device and replaces the current input.
              </Muted>
            </div>
            <Caption className="inline-flex items-center gap-2 rounded-full border border-primary bg-card px-4 py-2 shadow-sm">
              <Strong className="contents">
                <FileSpreadsheet aria-hidden="true" className="size-4 text-primary" />
                {acceptedDescription}
              </Strong>
            </Caption>
            <Muted className="text-success">
              <Strong>Release now · nothing is uploaded</Strong>
            </Muted>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ToolWorkspace(
  props: WorkspaceProps &
    Pick<
      ResultSurfaceProps,
      "initialJsonView" | "renderPreview" | "renderResult" | "renderResultActions" | "retainedResult"
    > & {
      highlightedInput?: ReactNode;
      inputHighlightMode?: "persistent" | "preview";
      inputFieldErrors?: Partial<Record<"text" | "secondary", string>>;
      onInputSubmit?: () => void;
      onSourceScroll?: (scroller: HTMLElement) => void;
      renderInputContent?: (source: ReactNode) => ReactNode;
      renderInputSettings?: () => ReactNode;
      renderSettings?: () => ReactNode;
      resultHeaderActions?: ReactNode;
      inputSurfaceTitle?: string;
      sourceClassName?: string;
      sourceHeader?: ReactNode;
      sourceRef?: Ref<HTMLElement>;
    },
) {
  const t = useTranslations("Workbench");
  const presentation = useWorkbenchPresentation();
  if (props.spec.input.kind === "files") {
    if (props.spec.input.engine === "image" && props.spec.category === "image-conversion") {
      return <ImageConversionWorkspace {...props} />;
    }
    return <FileProcessorWorkspace {...props} />;
  }

  const fields = Object.values(props.spec.settings.fields);
  const settingsOnly = props.spec.input.kind === "none";
  const hasMainSettings = !settingsOnly && fields.some((field) => field.pane === "main");
  const hasSideSettings = settingsOnly ? fields.length > 0 : fields.some((field) => (field.pane ?? "side") === "side");
  const hasInputSettings = fields.some((field) => field.pane === "input");
  const inputSettingsPadding =
    props.spec.input.kind === "fields" && props.spec.input.fields.every((field) => !field.multiline)
      ? ""
      : props.spec.input.kind === "text"
        ? "px-4 pt-4"
        : "px-4 pb-4";
  const inputSettings = props.renderInputSettings ? (
    props.renderInputSettings()
  ) : hasInputSettings ? (
    <SettingsPanel
      className={`shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] ${inputSettingsPadding}`}
      disabled={props.disabled}
      layout="grid"
      onChange={props.onSettingChange}
      onSubmit={() => {
        if (!props.primaryAction || props.primaryAction.disabled || props.primaryAction.running) return;
        props.primaryAction.onRun();
      }}
      pane="input"
      spec={props.spec.settings}
      values={props.settings}
    />
  ) : undefined;
  const layoutSwitchable =
    props.spec.input.kind === "text" ||
    (props.spec.input.kind === "fields" &&
      (props.spec.input.fields.length === 1 || props.spec.input.fields.every((field) => !field.multiline)));
  const layout = (layoutSwitchable ? presentation?.layout : null) ?? props.spec.layout ?? "side-by-side";
  const inputSplit = getInputSplitSizes(props.spec.input, 50, layout === "stacked" ? 30 : 15);
  const surfaceVariant = props.spec.input.kind !== "none" && layout === "stacked" ? "card" : "panel";
  const result = (
    <ResultSurface
      error={props.error}
      headerActions={props.resultHeaderActions}
      initialJsonView={props.initialJsonView}
      result={props.result}
      retainedResult={props.retainedResult}
      renderPreview={props.renderPreview}
      renderResult={props.renderResult}
      renderResultActions={props.renderResultActions}
      running={props.running}
      spec={props.spec}
      title={surfaceVariant === "card" ? stackedResultTitle(props.spec) : props.spec.labels.result}
      variant={surfaceVariant}
    />
  );
  const primaryContent =
    props.spec.input.kind === "none" ? (
      result
    ) : (
      <InputResultWorkspace
        defaultSize={inputSplit.defaultSize}
        inputSize={props.spec.inputSize}
        input={
          <WorkspaceInputSurface
            disabled={props.disabled}
            fieldErrors={props.inputFieldErrors}
            footer={props.spec.input.kind === "fields" ? inputSettings : undefined}
            header={props.spec.input.kind === "text" ? inputSettings : undefined}
            highlightedInput={props.highlightedInput}
            inputHighlightMode={props.inputHighlightMode}
            input={props.input}
            inputSpec={props.spec.input}
            onInputChange={props.onInputChange}
            onSubmit={props.onInputSubmit}
            onSourceScroll={props.onSourceScroll}
            renderContent={props.renderInputContent}
            title={props.inputSurfaceTitle}
            sourceClassName={props.sourceClassName}
            sourceHeader={props.sourceHeader}
            sourceRef={props.sourceRef}
            variant={surfaceVariant}
          />
        }
        layout={layout}
        layoutSwitchable={layoutSwitchable}
        minSize={inputSplit.minSize}
        result={result}
      />
    );
  const mainContent = hasMainSettings ? (
    <div className="flex h-full min-h-0 flex-col">
      <SettingsPanel
        className="shrink-0 border-b border-border p-4"
        disabled={props.disabled}
        layout="grid"
        onChange={props.onSettingChange}
        pane="main"
        spec={props.spec.settings}
        values={props.settings}
      />
      <div className="min-h-0 flex-1">{primaryContent}</div>
    </div>
  ) : (
    primaryContent
  );

  if (!hasSideSettings) {
    return <TextFileDropTarget props={props}>{mainContent}</TextFileDropTarget>;
  }

  const workspace = (
    <SettingsStack
      className="h-full"
      collapsible={hasSideSettings && !settingsOnly}
      defaultCollapsed={!settingsOnly ? "secondary" : undefined}
      defaultSize={75}
      minSize={75}
    >
      {mainContent}
      <ToolOptionsPanel
        className="h-full overflow-y-auto bg-card p-[18px]"
        title={props.spec.optionsPanel?.title ?? t("settings")}
        variant="plain"
      >
        {props.renderSettings ? (
          props.renderSettings()
        ) : (
          <SettingsPanel
            disabled={props.disabled}
            layout={props.spec.optionsPanel?.layout}
            onChange={props.onSettingChange}
            pane={settingsOnly ? undefined : "side"}
            spec={props.spec.settings}
            values={props.settings}
          />
        )}
        {props.spec.optionsPanel?.note ? (
          <Muted className="text-muted-foreground">{props.spec.optionsPanel.note}</Muted>
        ) : null}
      </ToolOptionsPanel>
    </SettingsStack>
  );

  return <TextFileDropTarget props={props}>{workspace}</TextFileDropTarget>;
}

export default ToolWorkspace;
