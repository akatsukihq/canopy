import type { ReactNode } from "react";
import { Caption, Card, H2, Label, P } from "@/components/ui/index.tsx";

/** One setting: what it is on the left, its value or control on the right. Stacks on narrow screens. */
export function SettingRow({
  children,
  description,
  details,
  id,
  label,
  status,
}: {
  children: ReactNode;
  description: ReactNode;
  details?: ReactNode;
  /** Id of the control, so the visible title labels it. */
  id?: string;
  label: string;
  status?: ReactNode;
}) {
  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-start md:gap-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {id ? (
            <Label className="font-medium" htmlFor={id}>
              {label}
            </Label>
          ) : (
            <P className="font-medium">{label}</P>
          )}
          {status}
        </div>
        <Caption className="mt-0.5 block text-muted-foreground">{description}</Caption>
        {details}
      </div>
      <div className="min-w-0 md:justify-self-end">{children}</div>
    </li>
  );
}

/** A titled group of setting rows. */
export function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  title: string;
}) {
  return (
    <Card aria-label={title} className="overflow-hidden p-0" role="region">
      <div className="border-b border-border bg-muted/40 px-5 py-3">
        <H2 className="text-sm font-semibold">{title}</H2>
        <Caption className="block text-muted-foreground">{description}</Caption>
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </Card>
  );
}
