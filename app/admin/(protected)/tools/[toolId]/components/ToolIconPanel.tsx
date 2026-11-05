"use client";

import {
  H3,
  Caption,
  Muted,
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@/components/ui/index.tsx";
import { ImagePlus, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactElement,
} from "react";
import { ToolIcon } from "../../../../../../components/ToolIcon";
import { removeToolIconAction, uploadToolIconAction, type ToolContentActionState } from "../../actions";

const IDLE: ToolContentActionState = { status: "idle", message: "" };

export interface ToolIconPanelProps {
  /** Raw stored icon; `ToolIcon` validates it. */
  readonly icon: unknown;
  readonly name: string;
  readonly toolId: string;
  readonly uploadsEnabled: boolean;
}

function IconAction({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="border-border bg-card shadow-sm"
          size="icon-xs"
          variant="secondary"
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ToolIconPanel({ icon, name, toolId, uploadsEnabled }: ToolIconPanelProps): ReactElement {
  const inputId = useId();
  const toastId = `${inputId}-feedback`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [, uploadAction, isUploading] = useActionState(async (previous: ToolContentActionState, data: FormData) => {
    // React resets file inputs after a form action; retain the file for retries.
    if (selectedFile) data.set("icon", selectedFile);
    const next = await uploadToolIconAction(previous, data);
    if (next.status === "success") resetSelection();
    showFeedback(next);
    return next;
  }, IDLE);
  const [, removeAction, isRemoving] = useActionState(async (previous: ToolContentActionState, data: FormData) => {
    const next = await removeToolIconAction(previous, data);
    if (next.status === "success") resetSelection();
    showFeedback(next);
    return next;
  }, IDLE);
  const busy = isUploading || isRemoving;

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function showFeedback(result: ToolContentActionState): void {
    if (result.status === "success") toast.success(result.message, { id: toastId });
    if (result.status === "error") toast.error(result.message, { id: toastId });
  }

  function preview(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    toast.dismiss(toastId);
  }

  function resetSelection(): void {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
    toast.dismiss(toastId);
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="grid gap-3">
      <H3 className="text-base" id={`${inputId}-heading`}>
        Tool icon
      </H3>

      <TooltipProvider>
        <div
          aria-label="Tool icon preview"
          className="group relative grid size-44 place-items-center overflow-hidden rounded-xl border border-border bg-muted"
          role="group"
        >
          {previewUrl ? (
            // This blob URL is local-only and exists solely for the selected-file preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Selected icon preview" className="size-full object-contain" src={previewUrl} />
          ) : (
            <ToolIcon media={icon} name={name} size={128} toolId={toolId} />
          )}
          {uploadsEnabled || icon != null ? (
            <div
              className={`absolute top-2 right-2 flex items-center gap-1 transition-opacity motion-reduce:transition-none ${
                selectedFile || busy
                  ? ""
                  : "[@media(hover:hover)_and_(pointer:fine)]:pointer-events-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
              }`}
            >
              {uploadsEnabled ? (
                <form action={uploadAction} className="flex gap-1">
                  <input name="toolId" type="hidden" value={toolId} />
                  <Input
                    accept="image/png,image/jpeg,image/webp"
                    aria-describedby={`${inputId}-guidance`}
                    aria-label="Choose an icon"
                    className="sr-only"
                    disabled={busy}
                    id={inputId}
                    name="icon"
                    onChange={preview}
                    ref={inputRef}
                    required={!selectedFile}
                    tabIndex={-1}
                    type="file"
                  />
                  <IconAction
                    aria-describedby={`${inputId}-guidance`}
                    disabled={busy}
                    label={selectedFile ? "Choose another" : "Choose icon"}
                    onClick={() => inputRef.current?.click()}
                    type="button"
                  >
                    <ImagePlus aria-hidden="true" />
                  </IconAction>
                  {selectedFile ? (
                    <>
                      <IconAction disabled={busy} label="Upload" loading={isUploading} type="submit">
                        <Upload aria-hidden="true" />
                      </IconAction>
                      <IconAction disabled={busy} label="Reset" onClick={resetSelection} type="button">
                        <RotateCcw aria-hidden="true" />
                      </IconAction>
                    </>
                  ) : null}
                </form>
              ) : null}
              {icon && !selectedFile ? (
                <form action={removeAction}>
                  <input name="toolId" type="hidden" value={toolId} />
                  <IconAction disabled={busy} label="Remove uploaded icon" loading={isRemoving} type="submit">
                    <Trash2 aria-hidden="true" />
                  </IconAction>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      </TooltipProvider>

      {selectedFile ? <Caption className="break-all text-muted-foreground">{selectedFile.name}</Caption> : null}

      {uploadsEnabled ? (
        <Muted id={`${inputId}-guidance`}>PNG, JPG, or WebP · up to 1 MB.</Muted>
      ) : (
        <Muted id={`${inputId}-guidance`}>
          <span className="block font-medium text-foreground">Icon uploads are disabled</span>
          Configure Cloudinary credentials to enable uploads.
        </Muted>
      )}
    </section>
  );
}
