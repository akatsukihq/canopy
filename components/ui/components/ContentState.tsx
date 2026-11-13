import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";

import { cn } from "../lib/utils.ts";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "./empty.tsx";

export type ContentStateProps = Omit<ComponentProps<"div">, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Undefined uses the error/loading icon; null explicitly omits it. */
  icon?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  state?: "empty" | "no-results" | "error" | "loading" | "unavailable" | "waiting" | "cancelled" | "complete";
  density?: "page" | "section" | "panel" | "compact";
  align?: "center" | "start";
  /** `"p"` renders status text that must not become a document heading (crawlers read headings as page structure). */
  headingLevel?: "h1" | "h2" | "h3" | "p";
  /** Opt in for asynchronously changing messages, not the action controls. */
  announcement?: "off" | "polite" | "assertive";
};

/** Presentation only: the caller owns permissions, recovery handlers and pending actions. */
export function ContentState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  state = "empty",
  density = "section",
  align = "center",
  headingLevel: Heading = "h2",
  announcement = state === "loading" ? "polite" : "off",
  className,
  ...props
}: ContentStateProps) {
  const compact = density === "compact";
  const panel = density === "panel";
  const media =
    icon === undefined ? (
      state === "error" ? (
        <CircleAlert />
      ) : state === "loading" ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      ) : null
    ) : (
      icon
    );

  return (
    <Empty
      {...props}
      data-slot="content-state"
      data-state={state}
      data-density={density}
      className={cn(
        "w-full flex-1 rounded-none border-0 bg-transparent p-6 text-pretty",
        compact ? "gap-3 p-4" : panel ? "gap-4 p-4" : "gap-6",
        density === "page" && "mx-auto max-w-xl",
        align === "start" && "items-start text-left",
        className,
      )}
    >
      <EmptyHeader
        aria-live={announcement}
        aria-atomic={announcement === "off" ? undefined : true}
        className={cn(
          "w-full max-w-md gap-3",
          compact && "gap-2",
          panel && "gap-2.5",
          align === "start" && "items-start text-left",
        )}
      >
        {media ? (
          <EmptyMedia
            aria-hidden="true"
            className={cn(
              "m-0 size-12 rounded-full bg-muted text-muted-foreground [&_svg]:size-6",
              panel && "size-9 [&_svg]:size-5",
              compact && "size-6 bg-transparent [&_svg]:size-5",
              state === "error" && "bg-destructive-soft text-destructive",
            )}
          >
            {media}
          </EmptyMedia>
        ) : null}
        <Heading
          className={cn(
            "max-w-full font-heading text-xl leading-tight font-semibold text-foreground [overflow-wrap:anywhere]",
            panel && "text-[17px]",
            compact && "font-sans text-sm leading-5",
          )}
        >
          {title}
        </Heading>
        {description ? (
          <EmptyDescription
            className={cn(
              "max-w-full text-sm leading-normal [overflow-wrap:anywhere]",
              (compact || panel) && "text-[13px]",
            )}
          >
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action || secondaryAction ? (
        <EmptyContent
          className={cn(
            "w-full max-w-md flex-row flex-wrap justify-center gap-2 text-pretty",
            "[&>div]:flex [&>div]:w-full [&>div]:flex-wrap [&>div]:justify-center [&>div]:gap-2",
            "[&_button]:h-auto [&_a]:h-auto [&_button]:min-h-11 [&_a]:min-h-11 [&_button]:max-w-full [&_a]:max-w-full",
            "[&_button]:py-1.5 [&_a]:py-1.5 [&_button]:whitespace-normal [&_a]:whitespace-normal [&_button]:[overflow-wrap:anywhere] [&_a]:[overflow-wrap:anywhere]",
            "max-sm:flex-col max-sm:items-stretch max-sm:[&>div]:flex-col max-sm:[&_button]:w-full max-sm:[&_a]:w-full",
            "sm:[&_button]:min-h-9 sm:[&_a]:min-h-9",
            align === "start" && "justify-start [&>div]:justify-start",
          )}
        >
          {action}
          {secondaryAction}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
