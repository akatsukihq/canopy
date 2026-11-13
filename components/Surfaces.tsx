"use client";
import { useTranslations } from "next-intl";

import {
  Overline,
  InlineCode,
  P,
  Muted,
  H2,
  Caption,
  Button,
  ContentState,
  FileQueueItem,
  FileUploadZone,
  StatusBadge,
  WorkspacePanelHeader,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import { OrderableList, type OrderableItemState } from "@/components/ui/components/OrderableList.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { CircleAlert, File as FileIcon, GripVertical, Inbox, LoaderCircle, Maximize2, Minus, Plus } from "lucide-react";
import {
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";

import { OverlayStack, ScrollRegion, Stack } from "./Stacks";

export type WorkspaceSurfacePurpose = "source" | "editor" | "result" | "preview" | "inspector";

export type WorkspaceSurfaceState = "ready" | "empty" | "loading" | "error";

export type WorkspaceSurfaceProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  actions?: ReactNode;
  children?: ReactNode;
  contentClassName?: string;
  description?: ReactNode;
  header?: "visible" | "sr-only";
  meta?: ReactNode;
  metaPosition?: "actions" | "start";
  purpose?: WorkspaceSurfacePurpose;
  scroll?: "none" | "content";
  state?: WorkspaceSurfaceState;
  stateAction?: ReactNode;
  stateDescription?: ReactNode;
  stateIcon?: ReactNode;
  stateTitle?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  variant?: "card" | "panel";
};

const DEFAULT_STATE_TITLES: Record<Exclude<WorkspaceSurfaceState, "ready">, string> = {
  empty: "emptySurface",
  error: "errorSurface",
  loading: "loading",
};

const DEFAULT_STATE_ICONS: Record<Exclude<WorkspaceSurfaceState, "ready">, ReactNode> = {
  empty: <Inbox aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
  loading: <LoaderCircle aria-hidden="true" className="animate-spin" />,
};

function WorkspaceSurface({
  actions,
  children,
  className,
  contentClassName,
  description,
  header = "visible",
  meta,
  metaPosition = "actions",
  purpose = "source",
  scroll = "none",
  state = "ready",
  stateAction,
  stateDescription,
  stateIcon,
  stateTitle,
  status,
  title,
  variant = "panel",
  ...props
}: WorkspaceSurfaceProps) {
  const t = useTranslations("Workbench");
  const headingId = useId();
  const content =
    state === "ready" ? (
      children
    ) : (
      <ContentState
        className="min-h-0 flex-1"
        data-surface-state={state}
        state={state === "empty" && purpose === "result" ? "waiting" : state}
        density={state === "empty" && purpose === "result" ? "compact" : "section"}
        icon={state === "empty" && purpose === "result" ? null : (stateIcon ?? DEFAULT_STATE_ICONS[state])}
        title={stateTitle ?? t(DEFAULT_STATE_TITLES[state])}
        headingLevel="p"
        description={stateDescription}
        action={stateAction}
        announcement="polite"
      />
    );
  const heading = (
    <Overline className={cn("block truncate", variant === "card" && "text-muted-foreground")} id={headingId}>
      {title}
    </Overline>
  );
  const workspaceHeader =
    header === "visible" ? (
      variant === "panel" ? (
        <WorkspacePanelHeader actions={actions} meta={metaPosition === "actions" ? meta : undefined}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {heading}
              {status != null ? (
                <StatusBadge className="shrink-0" variant={state === "ready" ? "success" : "neutral"}>
                  {status}
                </StatusBadge>
              ) : null}
            </div>
            {metaPosition === "start" && meta != null ? <div className="min-w-0 truncate">{meta}</div> : null}
          </div>
        </WorkspacePanelHeader>
      ) : (
        <header
          className="@container flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-2"
          data-slot="workspace-header"
        >
          <div
            className={cn(
              "min-w-0",
              metaPosition === "start" &&
                "flex flex-1 flex-col items-start gap-1 py-1 @min-[28rem]:flex-row @min-[28rem]:items-center @min-[28rem]:gap-3 @min-[28rem]:py-0",
            )}
          >
            <div className="min-w-0 max-w-full shrink-0">
              {status !== undefined && status !== null ? (
                <div className="flex min-w-0 items-center gap-2">
                  {heading}
                  {status}
                </div>
              ) : (
                heading
              )}
              {description ? <Muted className="mt-0.5 truncate text-muted-foreground">{description}</Muted> : null}
            </div>
            {metaPosition === "start" && meta != null ? (
              <div className="flex min-w-0 max-w-full items-center">{meta}</div>
            ) : null}
          </div>
          {metaPosition === "actions" && meta !== undefined && meta !== null ? (
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1">
              <Caption className="min-w-0 truncate text-right text-muted-foreground">{meta}</Caption>
              {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1">{actions}</div> : null}
            </div>
          ) : actions ? (
            <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-1">{actions}</div>
          ) : null}
        </header>
      )
    ) : (
      <H2 className="sr-only" id={headingId}>
        {title}
      </H2>
    );

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        variant === "card" ? "gap-2 overflow-visible bg-transparent" : "overflow-hidden bg-card",
        className,
      )}
      data-purpose={purpose}
      data-state={state}
      data-surface="workspace"
      {...props}
    >
      {variant === "card" ? null : workspaceHeader}
      {variant === "panel" && header === "visible" && description ? (
        <Muted className="shrink-0 px-4 py-3 text-muted-foreground">{description}</Muted>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          variant === "card" ? "overflow-hidden rounded-lg border border-border bg-muted/45" : undefined,
        )}
        data-slot="workspace-card"
      >
        {variant === "card" ? workspaceHeader : null}
        {scroll === "content" && state === "ready" ? (
          <ScrollRegion
            accessibleName={t("workspaceContent", { label: typeof title === "string" ? title : t("workspace") })}
            className="flex-1"
            data-slot="workspace-content"
          >
            <div className={cn("flex min-h-full min-w-0 flex-col", contentClassName)}>{content}</div>
          </ScrollRegion>
        ) : (
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", contentClassName)} data-slot="workspace-content">
            {content}
          </div>
        )}
      </div>
    </section>
  );
}

export type FileIntakeSurfaceProps = Omit<WorkspaceSurfaceProps, "children" | "purpose" | "state"> & {
  accept?: string;
  disabled?: boolean;
  intakeDescription?: ReactNode;
  intakeHint?: ReactNode;
  intakeIcon?: ReactNode;
  intakeTitle: string;
  maxFiles?: number;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
};

function FileIntakeSurface({
  accept,
  disabled = false,
  intakeDescription,
  intakeHint,
  intakeIcon,
  intakeTitle,
  maxFiles,
  multiple = false,
  onFiles,
  ...surfaceProps
}: FileIntakeSurfaceProps) {
  const t = useTranslations("Workbench");
  const inputRef = useRef<HTMLInputElement>(null);

  function deliverFiles(files: FileList | readonly File[]) {
    const nextFiles = Array.from(files).slice(0, maxFiles ?? (multiple ? undefined : 1));
    if (nextFiles.length > 0) onFiles(nextFiles);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (disabled) return;
    deliverFiles(event.dataTransfer.files);
  }

  return (
    <WorkspaceSurface purpose="source" {...surfaceProps}>
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <input
          accept={accept}
          className="sr-only"
          disabled={disabled}
          multiple={multiple}
          onChange={(event) => {
            if (event.target.files) deliverFiles(event.target.files);
            event.target.value = "";
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        <FileUploadZone
          className="max-w-[500px]"
          description={intakeDescription}
          hint={intakeHint ?? t(multiple ? "browseFiles" : "browseFile")}
          disabled={disabled}
          icon={intakeIcon}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          title={intakeTitle}
        />
      </div>
    </WorkspaceSurface>
  );
}

export type FileQueueSurfaceProps<Item> = Omit<WorkspaceSurfaceProps, "children" | "purpose" | "state"> & {
  emptyDescription?: ReactNode;
  disabled?: boolean;
  getIcon?: (item: Item) => ReactNode;
  getId: (item: Item) => string;
  getMetadata: (item: Item) => ReactNode;
  getName: (item: Item) => ReactNode;
  items: readonly Item[];
  onReorder?: (items: Item[]) => void;
  renderAction?: (item: Item) => ReactNode;
};

function FileQueueSurface<Item>({
  disabled = false,
  emptyDescription,
  getIcon,
  getId,
  getMetadata,
  getName,
  items,
  onReorder,
  renderAction,
  ...surfaceProps
}: FileQueueSurfaceProps<Item>) {
  const t = useTranslations("Workbench");
  const renderFile = (item: Item, orderable?: OrderableItemState) => (
    <div className="flex items-center gap-2 border-b border-border" key={getId(item)}>
      {orderable ? (
        <Button
          {...orderable.attributes}
          {...orderable.listeners}
          aria-label={t("reorderFile", { name: String(getName(item)) })}
          className="relative size-8 shrink-0 cursor-grab touch-none text-muted-foreground before:absolute before:inset-[-6px] before:content-[''] active:cursor-grabbing"
          disabled={orderable.disabled || items.length < 2}
          ref={orderable.setActivatorNodeRef}
          size="icon"
          variant="ghost"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
      <FileQueueItem
        action={renderAction?.(item)}
        className="min-w-0 flex-1 border-b-0"
        icon={getIcon?.(item) ?? <FileIcon aria-hidden="true" />}
        metadata={getMetadata(item)}
        name={getName(item)}
      />
    </div>
  );
  return (
    <WorkspaceSurface
      purpose="source"
      state={items.length === 0 ? "empty" : "ready"}
      stateDescription={emptyDescription ?? t("addFiles")}
      stateIcon={<FileIcon aria-hidden="true" />}
      stateTitle={t("noFiles")}
      {...surfaceProps}
    >
      <ScrollRegion
        accessibleName={t("fileQueue")}
        className="flex-1 px-4 [&_[data-slot=scroll-area-viewport]>div]:block!"
      >
        {onReorder ? (
          <OrderableList
            ariaLabel={t("fileOrder")}
            disabled={disabled}
            getId={getId}
            getLabel={(item) => String(getName(item))}
            items={items}
            onReorder={onReorder}
            renderItem={renderFile}
          />
        ) : (
          <Stack>{items.map((item) => renderFile(item))}</Stack>
        )}
      </ScrollRegion>
    </WorkspaceSurface>
  );
}

export type CollectionSurfaceProps<Item> = Omit<WorkspaceSurfaceProps, "children" | "purpose" | "state"> & {
  ariaLabel: string;
  disabled?: boolean;
  emptyDescription?: ReactNode;
  getId: (item: Item) => string;
  getLabel?: (item: Item) => string;
  items: readonly Item[];
  layout?: "grid" | "vertical";
  listClassName?: string;
  onReorder: (items: Item[]) => void;
  renderItem: (item: Item, state: OrderableItemState) => ReactNode;
};

function CollectionSurface<Item>({
  ariaLabel,
  disabled = false,
  emptyDescription,
  getId,
  getLabel,
  items,
  layout = "vertical",
  listClassName,
  onReorder,
  renderItem,
  ...surfaceProps
}: CollectionSurfaceProps<Item>) {
  const t = useTranslations("Workbench");
  return (
    <WorkspaceSurface
      purpose="editor"
      state={items.length === 0 ? "empty" : "ready"}
      stateDescription={emptyDescription ?? t("addItems")}
      stateTitle={t("emptyCollection")}
      {...surfaceProps}
    >
      <ScrollRegion accessibleName={ariaLabel} className="flex-1 p-4">
        <OrderableList
          ariaLabel={ariaLabel}
          className={cn(
            layout === "grid" ? "grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3" : "space-y-2",
            listClassName,
          )}
          disabled={disabled}
          getId={getId}
          getLabel={getLabel}
          items={items}
          layout={layout}
          onReorder={onReorder}
          renderItem={renderItem}
        />
      </ScrollRegion>
    </WorkspaceSurface>
  );
}

type CanvasPoint = { x: number; y: number };

export type CanvasSurfaceProps = Omit<WorkspaceSurfaceProps, "actions" | "children" | "purpose" | "state"> & {
  actions?: ReactNode;
  canvasLabel: string;
  children: ReactNode;
  initialZoom?: number;
  maxZoom?: number;
  minZoom?: number;
  onViewChange?: (view: { pan: CanvasPoint; zoom: number }) => void;
  overlay?: ReactNode;
  overlayPointerEvents?: "auto" | "none";
  panStep?: number;
  zoomStep?: number;
};

function CanvasAction({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClick} size="icon-xs" type="button" variant="outline">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CanvasSurface({
  actions,
  canvasLabel,
  children,
  className,
  initialZoom = 1,
  maxZoom = 4,
  minZoom = 0.25,
  onViewChange,
  overlay,
  overlayPointerEvents = "none",
  panStep = 16,
  zoomStep = 0.1,
  ...surfaceProps
}: CanvasSurfaceProps) {
  const t = useTranslations("Workbench");
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    origin: CanvasPoint;
    pan: CanvasPoint;
    pointerId: number;
  } | null>(null);
  const [zoom, setZoom] = useState(Math.min(maxZoom, Math.max(minZoom, initialZoom)));
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 0 });

  function updateView(nextZoom: number, nextPan: CanvasPoint) {
    const normalizedZoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    setZoom(normalizedZoom);
    setPan(nextPan);
    onViewChange?.({ pan: nextPan, zoom: normalizedZoom });
  }

  function fitToView() {
    const viewport = viewportRef.current;
    const content = contentRef.current?.firstElementChild;
    if (!(content instanceof HTMLElement) || !viewport) {
      updateView(initialZoom, { x: 0, y: 0 });
      return;
    }
    const contentWidth = content.offsetWidth;
    const contentHeight = content.offsetHeight;
    if (contentWidth <= 0 || contentHeight <= 0) {
      updateView(initialZoom, { x: 0, y: 0 });
      return;
    }
    const fittedZoom = Math.min(
      (viewport.clientWidth - 32) / contentWidth,
      (viewport.clientHeight - 32) / contentHeight,
      maxZoom,
    );
    updateView(fittedZoom, { x: 0, y: 0 });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, select, textarea, a, [data-no-canvas-pan]")) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      origin: { x: event.clientX, y: event.clientY },
      pan,
      pointerId: event.pointerId,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateView(zoom, {
      x: drag.pan.x + event.clientX - drag.origin.x,
      y: drag.pan.y + event.clientY - drag.origin.y,
    });
  }

  function stopPanning(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const panByKey: Partial<Record<string, CanvasPoint>> = {
      ArrowDown: { x: pan.x, y: pan.y + panStep },
      ArrowLeft: { x: pan.x - panStep, y: pan.y },
      ArrowRight: { x: pan.x + panStep, y: pan.y },
      ArrowUp: { x: pan.x, y: pan.y - panStep },
    };
    const nextPan = panByKey[event.key];
    if (nextPan) {
      event.preventDefault();
      updateView(zoom, nextPan);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      updateView(zoom + zoomStep, pan);
    } else if (event.key === "-") {
      event.preventDefault();
      updateView(zoom - zoomStep, pan);
    } else if (event.key === "0") {
      event.preventDefault();
      fitToView();
    }
  }

  const canvasActions = (
    <TooltipProvider>
      <Stack align="center" direction="row" gap="xs">
        {actions}
        <CanvasAction label={t("zoomOut")} onClick={() => updateView(zoom - zoomStep, pan)}>
          <Minus aria-hidden="true" />
        </CanvasAction>
        <Caption aria-live="polite" className="min-w-11 text-center text-muted-foreground">
          {Math.round(zoom * 100)}%
        </Caption>
        <CanvasAction label={t("zoomIn")} onClick={() => updateView(zoom + zoomStep, pan)}>
          <Plus aria-hidden="true" />
        </CanvasAction>
        <CanvasAction label={t("fitView")} onClick={fitToView}>
          <Maximize2 aria-hidden="true" />
        </CanvasAction>
      </Stack>
    </TooltipProvider>
  );

  return (
    <WorkspaceSurface actions={canvasActions} className={className} purpose="preview" {...surfaceProps}>
      <OverlayStack
        base={
          <div
            aria-label={canvasLabel}
            className="grid h-full min-h-0 w-full touch-none place-items-center overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onKeyDown={handleKeyDown}
            onLostPointerCapture={() => {
              dragRef.current = null;
            }}
            onPointerCancel={stopPanning}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopPanning}
            ref={viewportRef}
            role="region"
            tabIndex={0}
          >
            <div
              className="will-change-transform"
              ref={contentRef}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center",
              }}
            >
              {children}
            </div>
          </div>
        }
        className="h-full flex-1"
        overlay={overlay}
        overlayPointerEvents={overlayPointerEvents}
      />
    </WorkspaceSurface>
  );
}

export type NavigatorSurfaceProps<Item> = Omit<WorkspaceSurfaceProps, "children" | "purpose" | "state"> & {
  ariaLabel: string;
  emptyDescription?: ReactNode;
  getDescription?: (item: Item) => ReactNode;
  getIcon?: (item: Item) => ReactNode;
  getId: (item: Item) => string;
  getLabel: (item: Item) => ReactNode;
  items: readonly Item[];
  onSelect: (item: Item) => void;
  selectedId?: string;
};

function NavigatorSurface<Item>({
  ariaLabel,
  emptyDescription,
  getDescription,
  getIcon,
  getId,
  getLabel,
  items,
  onSelect,
  selectedId,
  ...surfaceProps
}: NavigatorSurfaceProps<Item>) {
  const t = useTranslations("Workbench");
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => getId(item) === selectedId),
  );

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowDown") nextIndex = Math.min(items.length - 1, index + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  return (
    <WorkspaceSurface
      purpose="inspector"
      state={items.length === 0 ? "empty" : "ready"}
      stateDescription={emptyDescription ?? t("nothingNavigate")}
      stateTitle={t("noNavigation")}
      {...surfaceProps}
    >
      <ScrollRegion accessibleName={ariaLabel} className="flex-1 p-2">
        <Stack gap="xs" role="list">
          {items.map((item, index) => {
            const id = getId(item);
            const selected = id === selectedId;
            return (
              <div key={id} role="listitem">
                <Button
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "h-auto w-full justify-start px-3 py-2 text-left whitespace-normal",
                    selected ? "bg-accent text-primary" : undefined,
                  )}
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => moveFocus(event, index)}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  tabIndex={index === selectedIndex ? 0 : -1}
                  type="button"
                  variant="ghost"
                >
                  {getIcon?.(item)}
                  <span className="min-w-0">
                    <span className="block truncate">{getLabel(item)}</span>
                    {getDescription ? (
                      <Caption className="mt-0.5 block truncate text-muted-foreground">{getDescription(item)}</Caption>
                    ) : null}
                  </span>
                </Button>
              </div>
            );
          })}
        </Stack>
      </ScrollRegion>
    </WorkspaceSurface>
  );
}

type GeneratedListProps<Item> = {
  getDescription?: (item: Item) => string | undefined;
  getId: (item: Item) => string;
  getLabel: (item: Item) => ReactNode;
  getValue: (item: Item) => string;
  items: readonly Item[];
  renderAction?: (item: Item, index: number) => ReactNode;
  variant?: "code" | "text";
};

function GeneratedList<Item>({
  getDescription,
  getId,
  getLabel,
  getValue,
  items,
  renderAction,
  variant = "code",
}: GeneratedListProps<Item>) {
  const t = useTranslations("Workbench");
  const longestLine = items.reduce((longest, item) => {
    const content = `${getValue(item)}\n${getDescription?.(item) ?? ""}`;
    return content.split(/\r\n?|\n/).reduce((length, line) => Math.max(length, line.length), longest);
  }, 0);

  return (
    <ScrollRegion accessibleName={t("generatedValues")} className="flex-1">
      <ol
        className="grid min-w-0 gap-2 p-4 font-mono text-code"
        style={{
          gridTemplateColumns:
            variant === "text"
              ? "minmax(0, 1fr)"
              : `repeat(auto-fill, minmax(min(100%, calc(${longestLine}ch + 8rem)), 1fr))`,
        }}
      >
        {items.map((item, index) => {
          const description = getDescription?.(item);
          return (
            <li className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/55 px-3 py-2" key={getId(item)}>
              <Caption className="shrink-0 font-sans text-muted-foreground">{getLabel(item)}</Caption>
              <div className="min-w-0 flex-1">
                {variant === "text" ? (
                  <P className="whitespace-pre-wrap [overflow-wrap:anywhere]">{getValue(item)}</P>
                ) : (
                  <InlineCode className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {getValue(item)}
                  </InlineCode>
                )}
                {description ? (
                  <Muted className="mt-1 whitespace-pre-wrap font-sans text-muted-foreground [overflow-wrap:anywhere]">
                    {description}
                  </Muted>
                ) : null}
              </div>
              {renderAction ? <div className="shrink-0">{renderAction(item, index)}</div> : null}
            </li>
          );
        })}
      </ol>
    </ScrollRegion>
  );
}

export {
  CanvasSurface,
  CollectionSurface,
  FileIntakeSurface,
  FileQueueSurface,
  GeneratedList,
  NavigatorSurface,
  WorkspaceSurface,
};
