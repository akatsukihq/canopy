"use client";

import {
  Button,
  InlineCode,
  Overline,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@/components/ui/index.tsx";
import { Check, Copy } from "lucide-react";
import { useState, useTransition, type ReactElement } from "react";
import { toggleToolAction } from "../../../../actions";

export function ToolIdentifier({ toolId }: { toolId: string }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copied = copiedId === toolId;
  const label = copied ? "Tool ID copied" : "Copy tool ID";

  async function copy() {
    setCopiedId(null);
    try {
      await navigator.clipboard.writeText(toolId);
      setCopiedId(toolId);
      toast.success("Tool ID copied.");
    } catch {
      toast.error("Couldn't copy the tool ID. Select it and copy it manually, or try again.");
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-left">
      <Overline className="shrink-0 text-muted-foreground">Tool ID</Overline>
      <div className="flex min-w-0 items-center gap-1">
        <InlineCode className="min-w-0 break-all select-all text-foreground">{toolId}</InlineCode>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={label} onClick={() => void copy()} size="icon-sm" type="button" variant="ghost">
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** Public visibility of the tool; lives in the page header. */
export function ToolVisibilitySwitch({
  blockedReason,
  enabled,
  toolId,
}: {
  readonly blockedReason: string | null;
  readonly enabled: boolean;
  readonly toolId: string;
}): ReactElement {
  const [pending, startTransition] = useTransition();
  const blocked = !enabled && blockedReason !== null;

  function toggle(next: boolean): void {
    const data = new FormData();
    data.set("toolId", toolId);
    data.set("enabled", String(next));
    startTransition(() => toggleToolAction(data));
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              aria-label="Visible on the public site"
              checked={enabled}
              disabled={blocked || pending}
              onCheckedChange={toggle}
              size="sm"
            />
            {enabled ? "Visible" : "Hidden"}
          </label>
        </TooltipTrigger>
        <TooltipContent>
          {blocked
            ? blockedReason
            : enabled
              ? "Hide this tool from the public site"
              : "Show this tool on the public site"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
