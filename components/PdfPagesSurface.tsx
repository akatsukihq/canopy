"use client";

import { useTranslations } from "next-intl";

/**
 * The page-thumbnail surface, shared by every tool whose spec declares
 * `input.inspect`.
 *
 * Inspection first returns geometry only. An IntersectionObserver then asks the
 * still-open worker session for JPEG bytes as cards approach the viewport.
 * Nothing here renders a PDF — `pdfjs-dist` is worker-only, and importing the
 * renderer from the main thread is what this indirection exists to prevent.
 *
 * `ToolPagePreview` declares only the geometry; the worker forwards whatever
 * the renderer produced, so the image bytes are read defensively rather than
 * through a declared field. Pages without bytes remain as loading placeholders.
 */

import { Strong, Caption, Muted, Button, CheckboxControl, MediaPreview, PdfViewer } from "@/components/ui/index.tsx";
import { OrderableList } from "@/components/ui/components/OrderableList.tsx";
import { GripVertical } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { WorkspaceSurface } from "@/components/Surfaces";
import type { ToolPagePreview } from "@/lib/tool-framework/run";
import { getRuntimeLimits } from "@/lib/tool-framework/limits";
import { parsePageSelection } from "@/lib/tool-framework/settings";

/** A rendered page: the declared geometry plus a blob URL for its thumbnail. */
export interface PdfPageImage {
  readonly pageHeight: number;
  readonly pageNumber: number;
  readonly pageWidth: number;
  readonly url?: string;
  readonly renderWidth?: number;
}

const NO_IMAGES: readonly PdfPageImage[] = [];
/** The renderer's own thumbnail type, used when the message carries no MIME. */
const THUMBNAIL_MIME = "image/jpeg";

const PdfInspectionContext = createContext<((pageNumbers: readonly number[], renderWidth?: number) => void) | null>(
  null,
);

export function PdfInspectionProvider({
  children,
  requestThumbnails,
}: {
  readonly children: ReactNode;
  readonly requestThumbnails: (pageNumbers: readonly number[], renderWidth?: number) => void;
}): ReactElement {
  return <PdfInspectionContext.Provider value={requestThumbnails}>{children}</PdfInspectionContext.Provider>;
}

function read(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function thumbnailBytes(preview: ToolPagePreview): ArrayBuffer | null {
  const buffer = read(preview, "buffer");
  return buffer instanceof ArrayBuffer ? buffer : null;
}

/**
 * Turns transferred thumbnail buffers into a bounded cache of blob URLs. Page
 * geometry is never evicted, so every card remains navigable while at most 24
 * decoded/downloadable thumbnail blobs stay live on the main thread.
 */
export function usePdfPageImages(previews: readonly ToolPagePreview[]): readonly PdfPageImage[] {
  const cacheRef = useRef(
    new Map<
      number,
      {
        readonly buffer: ArrayBuffer;
        readonly pageHeight: number;
        readonly pageWidth: number;
        readonly url: string;
      }
    >(),
  );
  const [, setRevision] = useState(0);

  const clearCache = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      URL.revokeObjectURL(entry.url);
    }
    cacheRef.current.clear();
  }, []);

  useEffect(() => {
    let changed = false;
    const previewByPage = new Map(previews.map((preview) => [preview.pageNumber, preview] as const));
    for (const [pageNumber, entry] of cacheRef.current) {
      const preview = previewByPage.get(pageNumber);
      if (
        !preview ||
        !thumbnailBytes(preview) ||
        preview.pageWidth !== entry.pageWidth ||
        preview.pageHeight !== entry.pageHeight
      ) {
        URL.revokeObjectURL(entry.url);
        cacheRef.current.delete(pageNumber);
        changed = true;
      }
    }
    for (const preview of previews) {
      const buffer = thumbnailBytes(preview);
      if (!buffer) continue;
      const existing = cacheRef.current.get(preview.pageNumber);
      if (existing?.buffer === buffer) continue;
      if (existing) URL.revokeObjectURL(existing.url);
      const mime = read(preview, "mime");
      cacheRef.current.delete(preview.pageNumber);
      cacheRef.current.set(preview.pageNumber, {
        buffer,
        pageHeight: preview.pageHeight,
        pageWidth: preview.pageWidth,
        url: URL.createObjectURL(
          new Blob([buffer], {
            type: typeof mime === "string" ? mime : THUMBNAIL_MIME,
          }),
        ),
      });
      changed = true;
    }
    while (cacheRef.current.size > getRuntimeLimits().pdfThumbnailCacheSize) {
      const oldest = cacheRef.current.entries().next().value as [number, { readonly url: string }] | undefined;
      if (!oldest) break;
      URL.revokeObjectURL(oldest[1].url);
      cacheRef.current.delete(oldest[0]);
      changed = true;
    }
    if (changed) setRevision((revision) => revision + 1);
  }, [previews]);

  useEffect(() => clearCache, [clearCache]);

  if (previews.length === 0) return NO_IMAGES;
  return previews.map((preview) => ({
    pageHeight: preview.pageHeight,
    pageNumber: preview.pageNumber,
    pageWidth: preview.pageWidth,
    url: cacheRef.current.get(preview.pageNumber)?.url,
    renderWidth: read(preview, "renderWidth") as number | undefined,
  }));
}

/** The expression a `pages` setting holds, whatever shape it was written in. */
function pageExpressionOf(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === "number").join(",");
  }
  return typeof value === "string" ? value : "";
}

/** The page numbers a `pages` setting selects, resolved against the previews. */
export function selectedPageNumbers(value: unknown, pages: readonly PdfPageImage[]): ReadonlySet<number> {
  const available = pages.map(({ pageNumber }) => pageNumber);
  const parsed = parsePageSelection(pageExpressionOf(value), pages.length);
  if (parsed === "all") return new Set(available);
  const wanted = new Set(parsed);
  return new Set(available.filter((pageNumber) => wanted.has(pageNumber)));
}

/** The value to write back into a `pages` setting for an explicit selection. */
export function pageExpression(pageNumbers: Iterable<number>): string {
  return [...pageNumbers].sort((left, right) => left - right).join(",");
}

export interface PdfPagesSurfaceProps {
  description?: string;
  disabled?: boolean;
  /** True while an inspection is in flight, so the surface can say so. */
  inspecting: boolean;
  /** Pages that may not be toggled right now, with the reason as a label. */
  lockedPages?: ReadonlySet<number>;
  /** Supplied by tools whose output order is the page order shown here. */
  onOrderChange?: (pageNumbers: readonly number[]) => void;
  /** Supplied by tools that act on a subset of the pages. */
  onToggle?: (pageNumber: number) => void;
  /** Already in the order they should be shown in. */
  pages: readonly PdfPageImage[];
  selected?: ReadonlySet<number>;
  title: string;
}

const PAGE_CLASSES = "min-w-0 rounded-xl border border-border bg-background p-2";
const THUMBNAIL_CLASSES = "mx-auto max-h-44 max-w-full w-auto rounded-md border border-border bg-white object-contain";
const GRID_CLASSES = "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(0,12rem))]";

export function PageThumbnail({ page }: { page: PdfPageImage }): ReactElement {
  const t = useTranslations("Workbench");
  const requestThumbnails = useContext(PdfInspectionContext);
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (page.url || !target || !requestThumbnails) return;
    if (typeof IntersectionObserver === "undefined") {
      requestThumbnails([page.pageNumber]);
      return;
    }
    let retry: ReturnType<typeof setTimeout> | null = null;
    let nearViewport = false;
    const demand = () => {
      if (!nearViewport) return;
      requestThumbnails([page.pageNumber]);
      retry = setTimeout(demand, 250);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        nearViewport = entries.some((entry) => entry.isIntersecting);
        if (retry !== null) clearTimeout(retry);
        retry = null;
        if (nearViewport) demand();
      },
      {
        root: target.closest<HTMLElement>("[data-slot=scroll-area-viewport]"),
        rootMargin: "600px 0px",
      },
    );
    observer.observe(target);
    return () => {
      nearViewport = false;
      if (retry !== null) clearTimeout(retry);
      observer.disconnect();
    };
  }, [page.pageNumber, page.url, requestThumbnails]);

  return (
    <div className="flex h-44 w-full shrink-0 items-center justify-center" ref={targetRef}>
      {page.url ? (
        <img
          alt=""
          draggable={false}
          className={THUMBNAIL_CLASSES}
          src={page.url}
          style={{ aspectRatio: `${page.pageWidth} / ${page.pageHeight}` }}
        />
      ) : (
        <div
          aria-label={t("mediaLoadingPagePreview", { page: page.pageNumber })}
          className="grid h-full w-full place-items-center text-muted-foreground"
        >
          <Caption>{t("mediaLoadingPreview")}</Caption>
        </div>
      )}
    </div>
  );
}

export function PdfPagesSurface({
  description,
  disabled = false,
  inspecting,
  lockedPages,
  onOrderChange,
  onToggle,
  pages,
  selected,
  title,
}: PdfPagesSurfaceProps): ReactElement {
  const t = useTranslations("Workbench");
  const requestThumbnails = useContext(PdfInspectionContext);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const previewIndex = pages.findIndex((page) => page.pageNumber === previewPage);
  return (
    <WorkspaceSurface
      className="min-h-0"
      contentClassName="p-4"
      description={description}
      purpose="preview"
      scroll="content"
      state={inspecting ? "loading" : pages.length > 0 ? "ready" : "empty"}
      stateDescription={inspecting ? t("mediaLocalPreviewHint") : t("mediaAddDocument")}
      stateTitle={inspecting ? t("mediaPreparingPages") : t("mediaNoPages")}
      title={title}
    >
      {onOrderChange ? (
        <OrderableList
          ariaLabel={title}
          className={GRID_CLASSES}
          disabled={disabled || pages.length < 2}
          dragSurface="card"
          getId={(page) => String(page.pageNumber)}
          getLabel={(page) => t("mediaPageNumber", { page: page.pageNumber })}
          items={pages}
          layout="grid"
          onReorder={(next) => onOrderChange(next.map(({ pageNumber }) => pageNumber))}
          renderItem={(page, orderable) => (
            <div
              className={`relative min-w-0 rounded-xl border border-border bg-background ${orderable.isDragging ? "shadow-lg ring-1 ring-primary/20" : ""}`}
              onMouseDown={(event) => orderable.listeners?.onMouseDown?.(event)}
              onTouchStart={(event) => orderable.listeners?.onTouchStart?.(event)}
            >
              <Button
                {...orderable.attributes}
                {...orderable.listeners}
                aria-label={t("mediaDragPage", { page: page.pageNumber })}
                className="absolute left-2 top-2 z-10 size-8 cursor-grab touch-none text-muted-foreground active:cursor-grabbing disabled:cursor-not-allowed"
                disabled={orderable.disabled}
                ref={orderable.setActivatorNodeRef}
                size="icon"
                type="button"
                variant="ghost"
                onMouseDown={undefined}
                onTouchStart={undefined}
              >
                <GripVertical aria-hidden="true" className="size-4" />
              </Button>
              <Button
                aria-label={t("mediaPreviewPage", { page: page.pageNumber })}
                className="h-auto w-full cursor-grab touch-pan-y select-none flex-col gap-0 rounded-xl p-2 pt-12 active:cursor-grabbing"
                disabled={disabled}
                onClick={() => setPreviewPage(page.pageNumber)}
                type="button"
                variant="card-action"
              >
                <PageThumbnail page={page} />
                <Caption className="mt-2 block text-center">
                  <Strong>{t("mediaPageNumber", { page: page.pageNumber })}</Strong>
                </Caption>
              </Button>
            </div>
          )}
        />
      ) : (
        <ol aria-label={title} className={GRID_CLASSES}>
          {pages.map((page) => {
            const isSelected = selected?.has(page.pageNumber) ?? false;
            const locked = lockedPages?.has(page.pageNumber) ?? false;
            return (
              <li
                className={`${PAGE_CLASSES} relative ${onToggle && isSelected ? "border-primary ring-1 ring-primary" : ""}`}
                key={page.pageNumber}
              >
                {onToggle ? (
                  <button
                    aria-label={t("mediaTogglePage", { selected: isSelected ? "yes" : "no", page: page.pageNumber })}
                    aria-pressed={isSelected}
                    className="w-full rounded-lg p-1 text-center outline-none transition enabled:hover:bg-accent enabled:hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    data-selected={isSelected}
                    disabled={disabled || locked}
                    onClick={() => onToggle(page.pageNumber)}
                    type="button"
                  >
                    <PageThumbnail page={page} />
                    <Caption className="mt-2 block">
                      <Strong>
                        {t("mediaPageSelection", { page: page.pageNumber, selected: isSelected ? "yes" : "no" })}
                      </Strong>
                    </Caption>
                  </button>
                ) : (
                  <>
                    <PageThumbnail page={page} />
                    <Caption className="mt-2 block text-center">
                      <Strong>{t("mediaPageNumber", { page: page.pageNumber })}</Strong>
                    </Caption>
                  </>
                )}
                {onToggle && isSelected && (
                  <CheckboxControl
                    aria-hidden="true"
                    checked
                    className="pointer-events-none absolute right-3 top-3"
                    tabIndex={-1}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {previewIndex >= 0 && (
        <MediaPreview
          open
          onOpenChange={(open) => {
            if (!open) setPreviewPage(null);
          }}
          title={t("mediaPageNumber", { page: previewPage ?? 1 })}
          description={t("mediaSourcePosition", { position: previewIndex + 1, count: pages.length })}
          viewportClassName="bg-card p-0 text-foreground sm:p-0"
        >
          <PdfViewer
            className="h-full w-full min-w-0"
            currentPage={previewIndex + 1}
            fileName={t("mediaPageNumber", { page: previewPage ?? 1 })}
            fit="page"
            onPageChange={(position) => setPreviewPage(pages[position - 1]?.pageNumber ?? null)}
            outline={pages.map((page, index) => ({
              id: `page-${page.pageNumber}`,
              title: t("mediaPageNumber", { page: page.pageNumber }),
              page: index + 1,
            }))}
            pageCount={pages.length}
            pages={pages.map((page, index) => ({
              pageNumber: index + 1,
              width: page.pageWidth,
              height: page.pageHeight,
              content: <PdfPreviewPage page={page} requestThumbnails={requestThumbnails ?? (() => {})} active />,
            }))}
          />
        </MediaPreview>
      )}
    </WorkspaceSurface>
  );
}

export function PdfPreviewPage({
  page,
  requestThumbnails,
  active,
  alt,
}: {
  page: ReturnType<typeof usePdfPageImages>[number];
  requestThumbnails: (pages: readonly number[], renderWidth?: number) => void;
  active: boolean;
  alt?: string;
}) {
  const t = useTranslations("Workbench");
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || !active) return;
    let visible = false;
    const render = () => {
      if (!visible) return;
      const width = Math.min(
        getRuntimeLimits().pdfPreviewMaxWidth,
        Math.ceil((node.getBoundingClientRect().width * window.devicePixelRatio) / 64) * 64,
      );
      if (width > 0 && (!page.url || width > (page.renderWidth ?? 0))) {
        requestThumbnails([page.pageNumber], width);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        render();
      },
      { rootMargin: "200px" },
    );
    const resize = new ResizeObserver(render);
    observer.observe(node);
    resize.observe(node);
    window.addEventListener("resize", render);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", render);
    };
  }, [active, page.pageNumber, page.url, page.renderWidth, requestThumbnails]);
  return (
    <div className="absolute inset-0" ref={element}>
      {page.url ? (
        <img
          alt={alt ?? t("mediaPdfPage", { page: page.pageNumber })}
          className="h-full w-full object-contain"
          src={page.url}
        />
      ) : (
        <Muted role="status">{t("mediaRenderingPageNumber", { page: page.pageNumber })}</Muted>
      )}
    </div>
  );
}
