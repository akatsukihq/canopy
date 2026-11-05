"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import styles from "./Assistant.module.css";

export function AssistantProgress({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  return (
    <p
      role="status"
      className={
        centered
          ? "my-auto flex w-full shrink-0 flex-col items-center gap-3 py-4 text-center text-caption text-muted-foreground"
          : "flex items-center gap-2 text-caption text-muted-foreground"
      }
    >
      <LoaderCircle
        className={`${centered ? "size-6" : "size-4"} shrink-0 text-primary motion-safe:animate-spin`}
        aria-hidden="true"
      />
      <span className={centered ? undefined : styles.assistantGeneratingText}>{children}</span>
    </p>
  );
}

/**
 * Live reasoning while a reply is produced. Open while the model thinks, folds away once the
 * answer starts streaming; models without readable reasoning show only the status line.
 */
export function AssistantThinking({ reasoning = "", answering }: { reasoning?: string; answering: boolean }) {
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(!answering), [answering]);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [reasoning, open]);
  if (!reasoning) return answering ? null : <AssistantProgress>Thinking…</AssistantProgress>;
  // Reasoning summaries mark their step headings in bold; the latest one names the current step.
  const text = reasoning.replace(/\*\*/g, "").trim();
  const step = [...reasoning.matchAll(/\*\*([^*\n]{1,80})\*\*/g)].at(-1)?.[1];
  return (
    <details className={styles.assistantThinking} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {answering ? (
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <LoaderCircle className="size-4 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
        )}
        <span role="status" className={answering ? undefined : styles.assistantGeneratingText}>
          {answering ? "Thought process" : step ? `Thinking · ${step}` : "Thinking…"}
        </span>
      </summary>
      <div ref={body} className={styles.assistantThinkingBody}>
        {text}
      </div>
    </details>
  );
}
