"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertBanner,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/index.tsx";
import { CropFrame, type CropBox } from "@/components/CropFrame";
import type { MediaFormat } from "@/lib/media";
import { cropBlogImage, fitCropRatio, resizeCrop, validateCropDimensions } from "../lib/imageCrop";

export function BlogImageCropDialog({
  src,
  format,
  title = "Crop image",
  isCover = false,
  onApply,
  onClose,
}: {
  src: string;
  format: MediaFormat;
  title?: string;
  isCover?: boolean;
  onApply: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [preset, setPreset] = useState("free");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const applying = useRef(false);
  const mounted = useRef(false);
  const presetId = useId();
  const hintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const source = new Image();
    setImage(null);
    setError("");
    setPreset("free");
    source.crossOrigin = "anonymous";
    source.onload = () => {
      if (!active) return;
      try {
        const bounds = { width: source.naturalWidth, height: source.naturalHeight };
        validateCropDimensions(bounds);
        setBox(fitCropRatio(bounds, isCover ? 16 / 9 : null));
        setImage(source);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load this image. Try again.");
      }
    };
    source.onerror = () => {
      if (active)
        setError(
          "Could not load the image for cropping. Check your connection and retry, or cancel and replace the image.",
        );
    };
    source.src = src;
    return () => {
      active = false;
      source.onload = null;
      source.onerror = null;
      source.src = "";
    };
  }, [src, attempt, isCover]);

  const bounds = { width: image?.naturalWidth ?? 1, height: image?.naturalHeight ?? 1 };
  const ratio = isCover
    ? 16 / 9
    : preset === "free"
      ? null
      : preset === "original"
        ? bounds.width / bounds.height
        : Number(preset);

  function choosePreset(value: string) {
    setPreset(value);
    setBox(
      fitCropRatio(
        bounds,
        isCover
          ? 16 / 9
          : value === "free"
            ? null
            : value === "original"
              ? bounds.width / bounds.height
              : Number(value),
      ),
    );
    setError("");
  }

  async function apply() {
    if (!image || applying.current) return;
    applying.current = true;
    setBusy(true);
    setError("");
    try {
      const file = await cropBlogImage(image, box, format);
      if (!mounted.current) return;
      await onApply(file);
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Could not apply this crop. Your image is unchanged; try again.",
        );
    } finally {
      applying.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !applying.current) onClose();
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto p-4 data-[size=default]:sm:max-w-3xl sm:p-5"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.stopPropagation();
          if (applying.current) event.preventDefault();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>Drag the selected area to move it. Drag the corner to resize.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {isCover ? (
            <span className="text-sm text-muted-foreground">Aspect ratio: 16:9</span>
          ) : (
            <>
              <Label htmlFor={presetId}>Aspect ratio</Label>
              <Select value={preset} disabled={!image || busy} onValueChange={choosePreset}>
                <SelectTrigger id={presetId} size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="original">Original</SelectItem>
                  <SelectItem value="1">1:1</SelectItem>
                  <SelectItem value={String(4 / 3)}>4:3</SelectItem>
                  <SelectItem value={String(16 / 9)}>16:9</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          <Button variant="ghost" size="sm" disabled={!image || busy} onClick={() => choosePreset("free")}>
            Reset
          </Button>
          {image && (
            <span className="ml-auto text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {box.width} × {box.height} px
            </span>
          )}
        </div>

        <div
          className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted p-3"
          aria-busy={!image && !error}
        >
          {image ? (
            <div
              className="relative isolate"
              style={{
                width: `min(100%, calc(min(42dvh, 340px) * ${bounds.width / bounds.height}))`,
                aspectRatio: `${bounds.width} / ${bounds.height}`,
              }}
              aria-describedby={hintId}
            >
              {/* Native image keeps the crop coordinate space aligned with its natural pixels. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                crossOrigin="anonymous"
                alt="Image to crop"
                className="block h-full w-full select-none"
                draggable={false}
              />
              <CropFrame
                bounds={bounds}
                box={box}
                disabled={busy}
                onChange={(next) => setBox((previous) => resizeCrop(next, previous, bounds, ratio))}
              />
            </div>
          ) : (
            <p className="px-3 text-center text-sm text-muted-foreground" role="status">
              {error ? "Image unavailable" : "Loading image…"}
            </p>
          )}
        </div>

        <p id={hintId} className="text-xs text-muted-foreground">
          Keyboard: Tab to the crop area or corner, then use arrow keys. Hold Shift for larger steps.
        </p>
        {error && (
          <AlertBanner variant="error">
            {error}
            {!image && (
              <Button className="ml-2" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                Retry loading
              </Button>
            )}
          </AlertBanner>
        )}
        <AlertDialogFooter className="flex-row items-center justify-end">
          <span className="mr-auto text-xs text-muted-foreground" role="status">
            {busy ? "Applying crop…" : "Changes apply after upload."}
          </span>
          <AlertDialogCancel size="sm" disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <Button
            size="sm"
            disabled={!image || (box.width === bounds.width && box.height === bounds.height)}
            loading={busy}
            onClick={() => {
              void apply();
            }}
          >
            Apply crop
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
