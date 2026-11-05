"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { Button, H1 } from "@/components/ui/index.tsx";
import type { AssistantRun } from "@/lib/assistant/types";
import { activeRun } from "@/lib/assistant/client";

/** Matches the server agent chain in lib/blog/generationAgents.ts. */
const AGENT_STEPS = ["Planning the article", "Writing the complete article", "Removing AI writing patterns"];

export function BlogGenerationProgress({
  run,
  brief,
  steps = [],
  streaming,
  refreshing = false,
  error,
  onCancel,
  onRetry,
  onEdit,
  onRefresh,
}: {
  run: AssistantRun | null;
  brief: string;
  steps?: { label: string; reasoning: string }[];
  streaming: boolean;
  refreshing?: boolean;
  error?: string;
  onCancel?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onRefresh?: () => void;
}) {
  const completed = run?.status === "completed";
  const active = streaming || (!!run && activeRun(run.status));
  const label = completed
    ? "Your draft is ready"
    : streaming
      ? "Writing your article…"
      : active
        ? "Generation status needs checking"
        : run?.status === "failed"
          ? "Generation failed"
          : run?.status === "cancelled"
            ? "Generation cancelled"
            : "Generation stopped";
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8" aria-labelledby="blog-generation-progress">
      <H1 id="blog-generation-progress" className="font-normal">
        Turning your idea into a blog
      </H1>
      <p className="mt-6 line-clamp-3 break-words text-body text-muted-foreground">{brief}</p>
      <div className="mt-6 flex items-center gap-4 rounded-xl bg-foreground px-5 py-4 text-background">
        {streaming ? (
          <LoaderCircle className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : completed ? (
          <Check className="size-5 shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="size-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1" role="status">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-caption opacity-75">
            {run?.resourceId
              ? "Your idea is saved. Nothing is published."
              : "Preparing your draft. Nothing is published."}
          </p>
        </div>
        {streaming && onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <ol className="mt-6 divide-y divide-border">
        {[
          { label: "Draft created", ready: !!run?.resourceId, working: streaming && !run?.resourceId, reasoning: "" },
          ...AGENT_STEPS.map((label) => {
            const started = steps.findIndex((step) => step.label === label);
            const later = steps.some((step, position) => position > started && started >= 0);
            return {
              label,
              ready: completed || (started >= 0 && later),
              working: streaming && started >= 0 && !later,
              reasoning: steps[started]?.reasoning ?? "",
            };
          }),
        ].map((stage) => (
          <li key={stage.label} className="py-4">
            <div
              className={`flex items-center gap-3 text-sm ${stage.ready ? "text-foreground" : stage.working ? "text-primary" : "text-muted-foreground"}`}
            >
              {stage.ready ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : stage.working ? (
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Circle className="size-4" aria-hidden="true" />
              )}
              <span className="flex-1">{stage.label}</span>
              <span className="text-caption">
                {stage.ready
                  ? "Ready"
                  : stage.working
                    ? "In progress"
                    : active
                      ? streaming
                        ? "Next"
                        : "Check status"
                      : "Not completed"}
              </span>
            </div>
            {stage.reasoning && (
              <details className="mt-2 ml-7" open={stage.working}>
                <summary className="cursor-pointer text-caption text-muted-foreground">Agent thinking</summary>
                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-caption text-muted-foreground">
                  {stage.reasoning}
                </p>
              </details>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="mt-4 text-caption text-destructive">
          {error}
        </p>
      )}
      <p className="mt-6 text-caption text-muted-foreground">
        {streaming
          ? "Your editable draft opens automatically when it is ready."
          : active
            ? "Refresh status to see whether your draft is ready."
            : "Your saved draft is available. Nothing has been published."}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {!streaming && active && onRefresh && (
          <Button variant="outline" disabled={refreshing} loading={refreshing} onClick={onRefresh}>
            Refresh status
          </Button>
        )}
        {!active && onEdit && <Button onClick={onEdit}>Edit draft</Button>}
        {!active && !completed && onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </section>
  );
}
