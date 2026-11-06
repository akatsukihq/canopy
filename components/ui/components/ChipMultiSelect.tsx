"use client";

import { X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx";
import { Caption } from "./typography.tsx";

export interface ChipOption {
  value: string;
  label: string;
  description?: ReactNode;
}

/** Pick several options from a fixed list: chosen ones show as removable chips, the rest are added from a list. */
export function ChipMultiSelect({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Add…",
  emptyText = "Nothing selected yet.",
  "aria-label": label,
  className,
}: {
  options: readonly ChipOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  "aria-label": string;
  className?: string;
}) {
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState({ width: 0, offset: 0 });
  // The list should line up with the whole field, not the small inline trigger.
  const measure = (open: boolean) => {
    if (!open || !field.current || !trigger.current) return;
    const box = field.current.getBoundingClientRect();
    setMenu({ width: box.width, offset: box.left - trigger.current.getBoundingClientRect().left });
  };
  const labels = new Map(options.map((option) => [option.value, option.label]));
  const available = options.filter((option) => !value.includes(option.value));
  return (
    <div
      ref={field}
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
        disabled && "opacity-60",
        className,
      )}
    >
      <ul aria-label={`Selected: ${label}`} className="contents">
        {value.map((id) => {
          const name = labels.get(id) ?? id;
          return (
            <li key={id}>
              <Caption className="inline-flex min-h-6 max-w-full items-center gap-0.5 rounded-full bg-accent pr-0.5 pl-2.5 text-xs text-primary">
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                <Button
                  aria-label={`Remove ${name}`}
                  className="size-5 rounded-full text-muted-foreground"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((entry) => entry !== id))}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" className="size-2.5" />
                </Button>
              </Caption>
            </li>
          );
        })}
      </ul>
      {available.length ? (
        <Select
          disabled={disabled}
          onOpenChange={measure}
          onValueChange={(next) => onChange([...value, next])}
          value=""
        >
          <SelectTrigger
            ref={trigger}
            aria-label={label}
            className="h-6 min-w-32 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent alignOffset={menu.offset} className="max-w-none" style={{ width: menu.width || undefined }}>
            {available.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="grid min-w-0">
                  {option.label}
                  {option.description ? (
                    <Caption className="line-clamp-1 whitespace-normal text-xs font-normal text-muted-foreground">
                      {option.description}
                    </Caption>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : value.length === 0 ? (
        <Caption className="px-1 text-muted-foreground">{emptyText}</Caption>
      ) : null}
    </div>
  );
}
