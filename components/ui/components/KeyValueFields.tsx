"use client";

import { useId, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { insertPairs, pairsFromPaste } from "@/utils/keyValuePaste.ts";

import { Button } from "./button.tsx";
import { FieldDescription, FieldError, FieldLabel } from "./field.tsx";
import { Input } from "./input.tsx";
import { H4 } from "./typography.tsx";

export interface KeyValueFieldsProps {
  label: string;
  rows: readonly { key: string; value: string }[];
  onChange: (rows: readonly { key: string; value: string }[]) => void;
  disabled?: boolean;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  rowLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  errors?: readonly string[];
  help?: string;
  onSubmit?: () => void;
}

export function KeyValueFields({
  label,
  rows,
  onChange,
  disabled = false,
  keyLabel = "Key",
  valueLabel = "Value",
  addLabel = "Add row",
  rowLabel = "row",
  keyPlaceholder,
  valuePlaceholder,
  errors,
  help,
  onSubmit,
}: KeyValueFieldsProps) {
  const id = useId();
  const keyInputs = useRef<(HTMLInputElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<number | "add" | null>(null);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") addButton.current?.focus();
    else keyInputs.current[target]?.focus();
  }, [rows]);

  const submit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      !onSubmit ||
      event.key !== "Enter" ||
      event.repeat ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    onSubmit();
  };

  const paste = (event: ClipboardEvent<HTMLInputElement>, index: number, field: "key" | "value") => {
    const pairs = pairsFromPaste(event.clipboardData.getData("text"), field);
    if (!pairs) return;
    event.preventDefault();
    const next = insertPairs(rows, index, pairs, (pair) => pair);
    pendingFocus.current = Math.min(
      next.length - 1,
      (rows[index]?.key || rows[index]?.value ? index + 1 : index) + pairs.length - 1,
    );
    onChange(next);
  };

  return (
    <fieldset
      aria-describedby={help ? `${id}-help` : undefined}
      aria-labelledby={`${id}-heading`}
      className="@container min-w-0 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H4 id={`${id}-heading`}>{label}</H4>
        <Button
          disabled={disabled}
          onClick={() => {
            pendingFocus.current = rows.length;
            onChange([...rows, { key: "", value: "" }]);
          }}
          ref={addButton}
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" /> {addLabel}
        </Button>
      </div>
      {rows.map((row, index) => {
        const error = errors?.[index];
        const describedBy =
          [help ? `${id}-help` : "", error ? `${id}-error-${index}` : ""].filter(Boolean).join(" ") || undefined;
        return (
          <div className="space-y-1.5" key={index}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 @min-[24rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
              <div className="col-span-2 grid min-w-0 gap-1.5 @min-[24rem]:col-span-1">
                <FieldLabel className={index ? "@min-[24rem]:sr-only" : undefined} htmlFor={`${id}-key-${index}`}>
                  {keyLabel}
                </FieldLabel>
                <Input
                  aria-describedby={describedBy}
                  aria-invalid={Boolean(error)}
                  aria-label={`${keyLabel} ${index + 1}`}
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={disabled}
                  id={`${id}-key-${index}`}
                  onChange={(event) =>
                    onChange(
                      rows.map((entry, position) =>
                        position === index ? { ...entry, key: event.currentTarget.value } : entry,
                      ),
                    )
                  }
                  onKeyDown={submit}
                  onPaste={(event) => paste(event, index, "key")}
                  placeholder={keyPlaceholder}
                  ref={(element) => {
                    keyInputs.current[index] = element;
                  }}
                  spellCheck={false}
                  value={row.key}
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <FieldLabel className={index ? "@min-[24rem]:sr-only" : undefined} htmlFor={`${id}-value-${index}`}>
                  {valueLabel}
                </FieldLabel>
                <Input
                  aria-describedby={describedBy}
                  aria-invalid={Boolean(error)}
                  aria-label={`${valueLabel} ${index + 1}`}
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={disabled}
                  id={`${id}-value-${index}`}
                  onChange={(event) =>
                    onChange(
                      rows.map((entry, position) =>
                        position === index ? { ...entry, value: event.currentTarget.value } : entry,
                      ),
                    )
                  }
                  onKeyDown={submit}
                  onPaste={(event) => paste(event, index, "value")}
                  placeholder={valuePlaceholder}
                  spellCheck={false}
                  value={row.value}
                />
              </div>
              <Button
                aria-label={`Remove ${rowLabel} ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  pendingFocus.current = rows.length === 1 ? "add" : Math.min(index, rows.length - 2);
                  onChange(rows.filter((_, position) => position !== index));
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            {error ? <FieldError id={`${id}-error-${index}`}>{error}</FieldError> : null}
          </div>
        );
      })}
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
    </fieldset>
  );
}
