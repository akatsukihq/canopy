import { BackButton, Caption, H1 } from "@/components/ui/index.tsx";
import type { ReactNode } from "react";

/** Compact title row for editor pages: back control, name, and the Save/Discard actions on the right. */
export function EditorHeader({
  backHref,
  backLabel,
  title,
  description,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <BackButton href={backHref} label={backLabel} />
        <div className="min-w-0">
          <H1 className="truncate text-xl">{title}</H1>
          {description ? <Caption className="block text-muted-foreground">{description}</Caption> : null}
        </div>
      </div>
      {actions}
    </header>
  );
}
