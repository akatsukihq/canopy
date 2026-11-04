import type { ReactNode } from "react";
import { Caption, Card, H2, Label, P } from "@/components/ui/index.tsx";
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
        "flex min-w-0 flex-col gap-2 border-l-2 bg-card px-4 py-3 transition-colors",
        changed ? "border-primary bg-primary/5" : "border-transparent",
      )}
    >
      <div className="flex min-h-7 items-center gap-2">
        {id ? (
          <Label className="font-medium" htmlFor={id}>
            {label}
          </Label>
        ) : (
          <P className="font-medium">{label}</P>
        )}
        {status}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {inline ? children : null}
        </div>
      </div>
      {inline ? null : <div className="min-w-0">{children}</div>}
      {error ? (
        <Caption className="block text-xs text-destructive" id={errorId} role="alert">
          {error}
        </Caption>
      ) : (
        <Caption className="block text-xs text-muted-foreground">{description}</Caption>
      )}
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
  children: ReactNode;
  description?: ReactNode;
  /** Omit to render the rows without a header (the page title already says it). */
  title?: string;
}) {
  return (
    <Card aria-label={title ?? "Settings"} className="min-w-0 gap-0 overflow-hidden p-0 shadow-none" role="region">
      {title ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <H2 className="text-sm font-semibold">{title}</H2>
            {description ? <Caption className="block text-muted-foreground">{description}</Caption> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <ul className="divide-y divide-border">{children}</ul>
    </Card>
  );
}
