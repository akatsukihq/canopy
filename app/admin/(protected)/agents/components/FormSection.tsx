import { Button, Caption, Card, H2 } from "@/components/ui/index.tsx";
import { appHref } from "@/lib/routing/subdomains.ts";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AgentForm } from "./agentForm";

export type SectionProps = {
  form: AgentForm;
  set: (patch: Partial<AgentForm>) => void;
  errors: Record<string, string>;
  disabled: boolean;
};

/** Opens a related admin page in a new tab, so unsaved edits here are kept. `href` is an /admin path. */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild className="h-auto px-0" size="sm" variant="link">
      <Link href={appHref(href)} rel="noopener" target="_blank">
        {children}
        <ArrowUpRight aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </Link>
    </Button>
  );
}

export function FormSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  /** Controls shown at the right of the header, such as on/off switches. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card aria-label={title} className="min-w-0 gap-0 overflow-hidden p-0 shadow-none" role="region">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <H2 className="text-sm font-semibold">{title}</H2>
          {actions}
        </div>
        {description ? <Caption className="block text-muted-foreground">{description}</Caption> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4">{children}</div>
    </Card>
  );
}
