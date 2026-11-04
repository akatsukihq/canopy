"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { AlignCenter, AlignLeft, AlignRight, Crop, Replace, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Popover,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import type { BlogImage } from "@/lib/blog/document";
import { blogImageDelivery } from "@/lib/blog/utils";
import { mediaUrl, type MediaRef } from "@/lib/media";
import { blogEditorImageSource } from "../lib/imageNode.ts";
import { BlogImageCropDialog } from "./BlogImageCropDialog.tsx";
import styles from "./BlogImageView.module.css";

export function resizedImageWidth(width: number, deltaX: number, containerWidth: number, alignment: string) {
  if (containerWidth <= 0) return width;
  const direction = alignment === "right" ? -1 : alignment === "center" ? 2 : 1;
  return Math.max(10, Math.min(100, Math.round(width + ((deltaX * direction) / containerWidth) * 100)));
}

export async function uploadBlogImageReplacement(
  file: File,
  source: MediaRef,
  { editor, getPos, updateAttributes }: Pick<NodeViewProps, "editor" | "getPos" | "updateAttributes">,
  upload: (file: File) => Promise<BlogImage | null>,
  isMounted: () => boolean,
) {
  function currentImage() {
    if (!isMounted() || editor.isDestroyed || !editor.isEditable)
      throw new Error("This image is no longer editable. Close crop and select an editable image.");
    const position = getPos();
    const current = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
    if (current?.type.name !== "image" || !current.attrs.media || mediaUrl(current.attrs.media) !== mediaUrl(source)) {
      throw new Error("The image changed. Close crop and select the image again.");
    }
    return current;
  }
  currentImage();
  const image = await upload(file);
  if (!image) throw new Error("Image upload failed. Your current image is unchanged; try again.");
  const current = currentImage();
  editor.view.dispatch(closeHistory(editor.state.tr));
  updateAttributes({
    ...image,
    alt: current.attrs.alt,
    caption: current.attrs.caption,
    displayWidth: current.attrs.displayWidth,
    alignment: current.attrs.alignment,
  });
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function BlogImageView({
  node,
  editor,
  extension,
  selected,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const settings = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const uploading = useRef(false);
  const hovered = useRef(false);
  const movingImage = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    width: number;
    containerWidth: number;
    latest: number;
  } | null>(null);
  const [editable, setEditable] = useState(editor.isEditable);
  const [pending, setPending] = useState(false);
  const [cropSource, setCropSource] = useState<MediaRef | null>(null);
  const [message, setMessage] = useState("");
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const settingsOpen = settingsVisible && editable && !cropSource;
  const width = Number(node.attrs.displayWidth ?? 100);
  const alignment = String(node.attrs.alignment ?? "center");
  const visibleWidth = previewWidth ?? width;
  const imageEdge = alignment === "center" ? (100 + visibleWidth) / 2 : visibleWidth;
  const settingsSide =
    (containerWidth * (100 - imageEdge)) / 100 >= 296 ? (alignment === "right" ? "left" : "right") : "below";
  const [widthText, setWidthText] = useState(String(width));
  const options = extension.options as {
    onUploadImage: (file: File) => Promise<BlogImage | null>;
  };

  useEffect(() => {
    setWidthText(String(width));
  }, [width]);
  useEffect(() => {
    if (selected && !movingImage.current) setSettingsVisible(true);
    else if (!hovered.current && !settings.current?.contains(document.activeElement)) setSettingsVisible(false);
  }, [selected]);
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    setContainerWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const syncEditable = () => {
      setEditable(editor.isEditable);
      if (!editor.isEditable) {
        drag.current = null;
        cancelClose();
        setSettingsVisible(false);
        setPreviewWidth(null);
        setCropSource(null);
      }
    };
    editor.on("update", syncEditable);
    return () => {
      mounted.current = false;
      drag.current = null;
      cancelClose();
      editor.off("update", syncEditable);
    };
  }, [editor]);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && !drag.current && !settings.current?.contains(document.activeElement))
        setSettingsVisible(false);
    }, 250);
  }
  function enterImage(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch" || !editor.isEditable || editor.isDestroyed || movingImage.current) return;
    hovered.current = true;
    cancelClose();
    setSettingsVisible(true);
  }
  function leaveImage() {
    hovered.current = false;
    scheduleClose();
  }
  function selectImage(focus = false) {
    const position = getPos();
    if (typeof position !== "number" || editor.isDestroyed) return;
    cancelClose();
    setSettingsVisible(true);
    editor.commands.setNodeSelection(position);
    if (focus) editor.view.focus();
  }
  function change(attributes: Record<string, string | number>) {
    if (editor.isEditable && typeof getPos() === "number") updateAttributes(attributes);
  }
  function commitWidth() {
    const value = Number(widthText);
    const next = widthText.trim() && Number.isFinite(value) ? Math.max(10, Math.min(100, Math.round(value))) : width;
    setWidthText(String(next));
    change({ displayWidth: next });
  }
  function startResize(event: PointerEvent<HTMLButtonElement>) {
    if (!editor.isEditable || event.button !== 0 || !wrapper.current) return;
    event.preventDefault();
    event.stopPropagation();
    cancelClose();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width,
      containerWidth: wrapper.current.getBoundingClientRect().width,
      latest: width,
    };
  }
  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || !editor.isEditable) return;
    current.latest = resizedImageWidth(current.width, event.clientX - current.x, current.containerWidth, alignment);
    setPreviewWidth(current.latest);
  }
  function finishResize(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPreviewWidth(null);
    if (!cancel) change({ displayWidth: current.latest });
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!hovered.current) scheduleClose();
  }
  async function replaceImage(file: File, source?: MediaRef) {
    if (!editor.isEditable || uploading.current) {
      if (source) throw new Error("The image is not ready to update. Try again.");
      return;
    }
    uploading.current = true;
    setPending(true);
    setMessage("");
    try {
      await uploadBlogImageReplacement(
        file,
        source ?? (node.attrs.media as MediaRef),
        { editor, getPos, updateAttributes },
        options.onUploadImage,
        () => mounted.current,
      );
      setMessage(`${source ? "Image cropped" : "Image replaced"}. Undo is available in the editor toolbar.`);
    } catch (error) {
      if (source) throw error;
      if (mounted.current)
        setMessage("Image could not be replaced. Your current image is unchanged; choose the file to retry.");
    } finally {
      uploading.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function closeCrop() {
    setCropSource(null);
    setSettingsVisible(true);
    requestAnimationFrame(() => {
      if (mounted.current && !editor.isDestroyed) editor.view.focus();
    });
  }

  const media = node.attrs.media as MediaRef;
  const image = (
    <img
      {...blogImageDelivery({ media })}
      sizes={
        containerWidth > 0
          ? `${Math.max(1, Math.round((containerWidth * visibleWidth) / 100))}px`
          : `(max-width: 767px) ${visibleWidth}vw, ${Math.round((916 * visibleWidth) / 100)}px`
      }
      alt={String(node.attrs.alt ?? "")}
      width={media.width}
      height={media.height}
      draggable={editable}
      data-drag-handle={editable ? "" : undefined}
      onDragStart={() => {
        movingImage.current = true;
        hovered.current = false;
        cancelClose();
        setSettingsVisible(false);
      }}
      onDragEnd={() => {
        movingImage.current = false;
      }}
    />
  );
  return (
    <NodeViewWrapper
      ref={wrapper}
      className={styles.wrapper}
      contentEditable={false}
      data-selected={selected}
      data-settings-open={settingsOpen}
    >
      <Popover.Root
        open={settingsOpen}
        onOpenChange={(open) => {
          cancelClose();
          setSettingsVisible(open);
        }}
      >
        <Popover.Anchor asChild>
          <figure
            className={styles.figure}
            data-alignment={alignment}
            style={{ width: `${previewWidth ?? width}%` }}
            onPointerEnter={enterImage}
            onPointerLeave={leaveImage}
          >
            <div className={styles.picture}>
              {editable ? (
                <Button
                  variant="ghost"
                  className={styles.imageButton}
                  aria-label={`Edit image: ${String(node.attrs.alt || "Add an image description")}`}
                  aria-haspopup="dialog"
                  aria-expanded={settingsOpen}
                  aria-controls={settingsOpen ? `${id}-settings` : undefined}
                  onClick={() => selectImage(true)}
                  onFocus={() => selectImage()}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      settings.current?.focus();
                    }
                    if ((event.metaKey || event.ctrlKey) && ["c", "x", "v"].includes(event.key.toLowerCase())) {
                      // Clipboard defaults run before Tiptap's deferred focus command.
                      selectImage(true);
                    }
                  }}
                >
                  {image}
                </Button>
              ) : (
                image
              )}
              {settingsOpen && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={styles.resize}
                  data-alignment={alignment}
                  role="slider"
                  aria-label="Image width"
                  aria-valuemin={10}
                  aria-valuemax={100}
                  aria-valuenow={previewWidth ?? width}
                  aria-valuetext={`${previewWidth ?? width}% wide`}
                  onPointerDown={startResize}
                  onPointerMove={moveResize}
                  onPointerUp={(event) => finishResize(event)}
                  onPointerCancel={(event) => finishResize(event, true)}
                  onLostPointerCapture={(event) => finishResize(event, true)}
                  onKeyDown={(event) => {
                    if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) {
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? 10
                          : event.key === "End"
                            ? 100
                            : Math.max(
                                10,
                                Math.min(
                                  100,
                                  width +
                                    (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
                                      (event.shiftKey ? 10 : 1),
                                ),
                              );
                      change({ displayWidth: next });
                    }
                  }}
                >
                  <span aria-hidden="true" />
                </Button>
              )}
            </div>
            {node.attrs.caption && <figcaption className={styles.caption}>{String(node.attrs.caption)}</figcaption>}
          </figure>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            ref={settings}
            id={`${id}-settings`}
            tabIndex={-1}
            className={styles.controls}
            aria-label="Image settings"
            side={settingsSide === "below" ? "bottom" : settingsSide}
            align="start"
            sideOffset={16}
            collisionPadding={12}
            onPointerEnter={() => {
              hovered.current = true;
              cancelClose();
            }}
            onPointerLeave={leaveImage}
            onFocusCapture={cancelClose}
            onBlurCapture={scheduleClose}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={() => {
              if (!editor.isDestroyed) editor.view.focus();
            }}
            onInteractOutside={(event) => {
              if (
                event.target instanceof Node &&
                (wrapper.current?.contains(event.target) || event.target === editor.view.dom)
              )
                event.preventDefault();
            }}
          >
            <TooltipProvider>
              <div className={styles.actions}>
                <div className={styles.alignment} role="group" aria-label="Image alignment">
                  {(
                    [
                      ["left", AlignLeft],
                      ["center", AlignCenter],
                      ["right", AlignRight],
                    ] as const
                  ).map(([value, Icon]) => (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Align image ${value}`}
                          aria-pressed={alignment === value}
                          onClick={() => change({ alignment: value })}
                        >
                          <Icon aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Align {value}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                <div className={styles.width}>
                  <Label htmlFor={`${id}-width`}>Width</Label>
                  <Input
                    id={`${id}-width`}
                    type="number"
                    size="sm"
                    min={10}
                    max={100}
                    step={1}
                    value={widthText}
                    suffix="%"
                    onChange={(event) => setWidthText(event.target.value)}
                    onBlur={commitWidth}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitWidth();
                      }
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (editor.isEditable && !uploading.current) setCropSource(media);
                  }}
                >
                  <Crop aria-hidden="true" />
                  Crop
                </Button>
                <Button size="sm" variant="outline" loading={pending} onClick={() => fileInput.current?.click()}>
                  <Replace aria-hidden="true" />
                  Replace
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="danger-subtle"
                      size="icon-sm"
                      aria-label="Remove image"
                      onClick={() => {
                        if (editor.isEditable) {
                          deleteNode();
                          editor.commands.focus();
                        }
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove image (undo available)</TooltipContent>
                </Tooltip>
                <input
                  ref={fileInput}
                  className={styles.fileInput}
                  tabIndex={-1}
                  aria-label="Replacement image file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void replaceImage(file);
                  }}
                />
              </div>
              <div className={styles.fields}>
                <div>
                  <Label htmlFor={`${id}-alt`}>Alt text</Label>
                  <Input
                    id={`${id}-alt`}
                    size="sm"
                    value={String(node.attrs.alt ?? "")}
                    maxLength={500}
                    placeholder="Describe the image for screen readers"
                    onChange={(event) => change({ alt: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`${id}-caption`}>Caption (optional)</Label>
                  <Input
                    id={`${id}-caption`}
                    size="sm"
                    value={String(node.attrs.caption ?? "")}
                    maxLength={1000}
                    placeholder="Caption shown below the image"
                    onChange={(event) => change({ caption: event.target.value })}
                  />
                </div>
              </div>
              <p className={styles.hint}>
                Drag the image to move it. Drag the corner to resize, or enter a width from 10–100%. Aspect ratio is
                preserved.
              </p>
              {message && (
                <p className={styles.message} role="status">
                  {message}
                </p>
              )}
            </TooltipProvider>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {cropSource && (
        <BlogImageCropDialog
          src={blogEditorImageSource(cropSource)}
          format={cropSource.format}
          title="Crop image"
          onApply={(file) => replaceImage(file, cropSource)}
          onClose={closeCrop}
        />
      )}
    </NodeViewWrapper>
  );
}
