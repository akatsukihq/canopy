"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, toast } from "@/components/ui/index.tsx";
import styles from "./ChangeCard.module.css";

type Props = {
  kind: "insert" | "replace" | "delete";
  title: string;
  placement: string;
  before: string;
  after: string;
  compact: boolean;
  actionable: boolean;
  stale: boolean;
  /** Replaces the default stale explanation, e.g. a validation error. */
  blockedReason?: string;
  actionLabel: string;
  onApply: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
};

/** Shared compact, summary and expanded section proposal from the assistant designs. */
export function ChangeCard({
  kind,
  title,
  placement,
  before,
  after,
  compact,
  actionable,
  stale,
  blockedReason,
  actionLabel,
  onApply,
  onDiscard,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const detailed = expanded || !compact;
  const excerpt = kind === "delete" ? before : after;
  const preview = excerpt.length > 110 ? `${excerpt.slice(0, 110).replace(/\s+\S*$/, "")}…` : excerpt;
  const wordCount = excerpt.trim().split(/\s+/).filter(Boolean).length;
  const badge = (
    <span className={`${styles.badge} rounded-full`} data-kind={kind}>
      {kind === "insert" ? "NEW SECTION" : kind === "delete" ? "DELETE" : "EDIT"}
    </span>
  );
  const toggleButton = (
    <Button
      ref={toggle}
      variant="link"
      size="xs"
      className={styles.toggle}
      aria-expanded={expanded}
      aria-controls={previewId}
      onClick={() => setExpanded((value) => !value)}
    >
      {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      {expanded ? "Hide" : compact ? "Show change" : "Show full change"}
    </Button>
  );
  const acting = useRef(false);
  const [pending, setPending] = useState(false);
  async function act(action: () => void | Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    setPending(true);
    try {
      await action();
      requestAnimationFrame(() => toggle.current?.focus());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not apply this change. Try again.");
    } finally {
      acting.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label={title} className={styles.card} data-detailed={detailed}>
      <div className={styles.header}>
        <h4 className={styles.title}>{title}</h4>
        {detailed && (
          <span className={styles.facts}>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        )}
        <div className={styles.actions}>
          {detailed && badge}
          {actionable && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label="Discard proposal"
                    disabled={pending}
                    onClick={() => act(onDiscard)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discard proposal</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={stale ? 0 : undefined} className={styles.actionTarget}>
                    <Button
                      size="icon-xs"
                      aria-label={actionLabel}
                      disabled={stale || pending}
                      onClick={() => act(onApply)}
                    >
                      <Check aria-hidden="true" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {stale ? (blockedReason ?? "This section changed. Ask for a fresh suggestion.") : actionLabel}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      {detailed ? (
        <>
          {expanded ? (
            <p className={styles.excerpt}>
              {placement} {toggleButton}
            </p>
          ) : (
            <p className={styles.excerpt}>
              {preview} {toggleButton}
            </p>
          )}
        </>
      ) : null}
      <div id={previewId} hidden={!expanded} className={styles.diff}>
        {kind !== "insert" && before && (
          <div className={styles.removed}>
            <span aria-hidden="true" className={styles.marker}>
              −
            </span>
            <p>
              <span className="sr-only">Removed text: </span>
              {before}
            </p>
          </div>
        )}
        {kind !== "delete" && after && (
          <div className={styles.added}>
            <span aria-hidden="true" className={styles.marker}>
              +
            </span>
            <p>
              <span className="sr-only">Added text: </span>
              {after}
            </p>
          </div>
        )}
      </div>
      {actionable && stale && (
        <p className={styles.facts} role="alert">
          {blockedReason ?? "This section changed. Ask for a fresh suggestion."}
        </p>
      )}
      {!detailed && (
        <div className={styles.footer}>
          {badge}
          <p className={styles.placement}>{placement}</p>
          {toggleButton}
        </div>
      )}
    </section>
  );
}
