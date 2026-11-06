"use client";

import { Input } from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { useRef, type ComponentProps } from "react";

const PLACEHOLDER = /(\{\{[^{}]*\}\})/;

/** Text with each {{…}} placeholder highlighted. */
export function TemplateText({ value }: { value: string }) {
  return (
    <>
      {value.split(PLACEHOLDER).map((part, index) =>
        index % 2 ? (
          <span className="rounded-sm bg-primary/10 text-primary" key={index}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Single-line input that highlights {{…}} placeholders. The real input keeps focus, caret, selection and
 * styling with transparent text; a non-interactive mirror on top draws the coloured text and follows its scroll.
 */
export function TemplateInput({
  className,
  wrapperClassName,
  value,
  ...props
}: Omit<ComponentProps<typeof Input>, "value"> & { value: string; wrapperClassName?: string }) {
  const mirror = useRef<HTMLSpanElement>(null);
  const follow = (input: HTMLInputElement) => {
    if (mirror.current) mirror.current.scrollLeft = input.scrollLeft;
  };
  return (
    <span className={cn("relative block min-w-0", wrapperClassName)}>
      <Input
        {...props}
        className={cn("text-transparent caret-foreground", className)}
        onKeyUp={(e) => follow(e.currentTarget)}
        onScroll={(e) => follow(e.currentTarget)}
        onSelect={(e) => follow(e.currentTarget)}
        value={value}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-3 text-[13px] whitespace-pre text-foreground",
          className,
          "bg-transparent shadow-none ring-0",
          props.disabled && "opacity-70",
        )}
        ref={mirror}
      >
        <TemplateText value={value} />
      </span>
    </span>
  );
}
