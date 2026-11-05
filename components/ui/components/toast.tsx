"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cn } from "../lib/utils.ts";

import { Button } from "./button.tsx";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, XIcon } from "lucide-react";

type ToastActionOptions = { label: React.ReactNode; onClick: React.MouseEventHandler<HTMLButtonElement> };
type ToastData = { closeButton?: boolean; cancel?: ToastActionOptions };
type ToastOptions = {
  id?: string | number;
  description?: React.ReactNode;
  duration?: number;
  closeButton?: boolean;
  action?: ToastActionOptions;
  cancel?: ToastActionOptions;
};
const manager = ToastPrimitive.createToastManager<ToastData>();

// Keep existing notification callers on the shared API during the Base UI migration.
function notify(type: string, title: React.ReactNode, options: ToastOptions = {}) {
  const id = manager.add({
    id: options.id === undefined ? undefined : String(options.id),
    title,
    type,
    description: options.description,
    priority: type === "error" ? "high" : "low",
    timeout: options.duration,
    actionProps: options.action
      ? {
          children: options.action.label,
          onClick(event) {
            options.action?.onClick(event);
            if (!event.defaultPrevented) manager.close(id);
          },
        }
      : undefined,
    data: { closeButton: options.closeButton, cancel: options.cancel },
  });
  return id;
}

const toast = Object.assign(manager, {
  success: (title: React.ReactNode, options?: ToastOptions) => notify("success", title, options),
  error: (title: React.ReactNode, options?: ToastOptions) => notify("error", title, options),
  info: (title: React.ReactNode, options?: ToastOptions) => notify("info", title, options),
  warning: (title: React.ReactNode, options?: ToastOptions) => notify("warning", title, options),
  dismiss: (id?: string | number) => manager.close(id === undefined ? undefined : String(id)),
});

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-2xl border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--direction:-1] [--offset-y:calc((var(--toast-offset-y)+var(--toast-index)*var(--gap))*var(--direction)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek)+var(--shrink)*var(--height))*var(--direction)))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(calc(var(--direction)*-150%))]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(calc(var(--direction)*-150%))]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return <ToastPrimitive.Title data-slot="toast-title" className={cn("text-sm font-medium", className)} {...props} />;
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action data-slot="toast-action" render={render} className={cn("shrink-0", className)} {...props} />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

const TONE: Record<string, string> = {
  success: "border-success/30 bg-success-soft text-foreground",
  error: "border-destructive/30 bg-destructive-soft text-foreground",
  warning: "border-warning/30 bg-warning-soft text-foreground",
  info: "border-primary/30 bg-primary/10 text-foreground",
};

function ToastIcon({ type }: { type: string | undefined }) {
  const Icon =
    type === "success"
      ? CircleCheckIcon
      : type === "info"
        ? InfoIcon
        : type === "warning"
          ? TriangleAlertIcon
          : type === "error"
            ? OctagonXIcon
            : type === "loading"
              ? Loader2Icon
              : null;
  return Icon ? (
    <Icon
      aria-hidden="true"
      data-slot="toast-icon"
      className={cn(
        "size-4 shrink-0",
        type === "success" && "text-success",
        type === "error" && "text-destructive",
        type === "warning" && "text-warning",
        type === "info" && "text-primary",
        type === "loading" && "animate-spin motion-reduce:animate-none",
      )}
    />
  ) : null;
}

function ToastList({ top, closeButton, dismissible }: { top: boolean; closeButton: boolean; dismissible: boolean }) {
  const { toasts, close } = ToastPrimitive.useToastManager<ToastData>();

  return toasts.map((toastItem) => (
    <Toast
      key={toastItem.id}
      toast={toastItem}
      swipeDirection={dismissible ? undefined : []}
      onKeyDown={(event) => {
        if (!dismissible && event.key === "Escape") event.preventBaseUIHandler();
      }}
      className={cn(
        toastItem.type && TONE[toastItem.type],
        top && "top-0 bottom-auto origin-top [--direction:1] after:top-auto after:bottom-full",
      )}
    >
      <ToastContent className="items-start">
        <span className="flex h-5 items-center">
          <ToastIcon type={toastItem.type} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastTitle />
          <ToastDescription />
          {toastItem.actionProps || toastItem.data?.cancel ? (
            <div className="mt-1.5 flex items-center gap-1">
              <ToastAction render={<Button variant="outline" size="xs" />} />
              {toastItem.data?.cancel ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    toastItem.data?.cancel?.onClick(event);
                    if (!event.defaultPrevented) close(toastItem.id);
                  }}
                >
                  {toastItem.data.cancel.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {dismissible && (toastItem.data?.closeButton ?? closeButton) ? <ToastClose className="-mt-1 -mr-1.5" /> : null}
      </ToastContent>
    </Toast>
  ));
}

function Toaster({
  children,
  toastManager = toast,
  position = "bottom-right",
  closeButton = true,
  dismissible = true,
  theme = "system",
  ...props
}: ToastPrimitive.Provider.Props & {
  position?: "top-right" | "bottom-right";
  closeButton?: boolean;
  dismissible?: boolean;
  theme?: "light" | "dark" | "system";
}) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport
          className={cn(
            position === "top-right" && "top-4 bottom-auto",
            theme === "dark" &&
              "[--popover:var(--surface-ink)] [--popover-foreground:var(--on-ink)] [--foreground:var(--on-ink)] [--muted-foreground:var(--on-ink-muted)] [--card:var(--surface-ink)] [--accent:var(--surface-ink)]",
            theme === "light" && "scheme-light",
          )}
        >
          <ToastList top={position === "top-right"} closeButton={closeButton} dismissible={dismissible} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
