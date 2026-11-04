import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Caption,
  Card,
  H2,
  Label,
  P,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";

/** One setting: label row, then the control, then help text (replaced by the error when there is one). */
export function SettingRow({
  actions,
  changed,
  children,
  description,
  details,
  error,
  errorId,
  id,
  inline,
  label,
  status,
}: {
  actions?: ReactNode;
  /** Highlights the row while it holds an unsaved edit. */
  changed?: boolean;
  children: ReactNode;
  description: ReactNode;
  details?: ReactNode;
  error?: string;
  /** Id of the error text, which the control references with aria-describedby. */
  errorId?: string;
  /** Id of the control, so the visible title labels it. */
  id?: string;
  /** Puts a small control (a switch) beside the title instead of below the help text. */
  inline?: boolean;
  label: string;
  status?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md px-2 py-1.5 transition-colors",
        inline && "col-span-full",
        changed && "bg-primary/5 ring-1 ring-primary/40",
      )}
    >
      <div className="flex min-h-6 items-center gap-1.5">
        {id ? (
          <Label className="font-medium" htmlFor={id}>
            {label}
          </Label>
        ) : (
          <P className="font-medium">{label}</P>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={`About ${label}`}
              className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{description}</TooltipContent>
        </Tooltip>
        {status}
        <div className={"ml-auto flex shrink-0 items-center gap-1"}>
          {actions}
          {inline ? children : null}
        </div>
      </div>
      {inline ? null : <div className="min-w-0 [&_button[role=combobox]]:h-8 [&_input]:h-8">{children}</div>}
      {error ? (
        <Caption className="block text-xs text-destructive" id={errorId} role="alert">
          {error}
        </Caption>
      ) : null}
      {details}
    </li>
  );
}

/** A titled group of setting rows. */
export function SettingsSection({
  actions,
  children,
  description,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  /** Omit to render the rows without a header (the page title already says it). */
  title?: string;
}) {
  return (
    <Card
      aria-label={title ?? "Settings"}
      className="mb-4 min-w-0 break-inside-avoid gap-0 overflow-hidden p-0 shadow-none"
      role="region"
    >
      {title ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted/40 px-4 py-2.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
          <div className="min-w-0 flex-1">
            <H2 className="text-sm font-semibold">{title}</H2>
            {description ? <Caption className="block text-muted-foreground">{description}</Caption> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children ? (
        <TooltipProvider>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-4 gap-y-2 p-3">{children}</ul>
        </TooltipProvider>
      ) : null}
    </Card>
  );
}
