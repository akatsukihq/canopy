"use client";

import { Input, Popover } from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { invalidPlaceholders } from "@/lib/agents/toolTemplate.ts";
import { createContext, useContext, useId, useRef, useState, type ComponentProps } from "react";
import {
  applyTemplateSuggestion,
  templateCompletion,
  type TemplateCompletion,
  type TemplateScope,
  type TemplateSuggestion,
} from "../lib/templateCompletion";

const PLACEHOLDER = /(\{\{[^{}]*\}\})/;
const REFERENCE = /^\{\{\s*(args|inputs)\.([A-Za-z0-9_$-]+)/;

/** The names a request template may reference: what completion suggests and what gets flagged when undeclared. */
const TemplateScopeContext = createContext<TemplateScope | null>(null);
export const TemplateScopeProvider = TemplateScopeContext.Provider;

function problemWith(part: string, scope: TemplateScope | null): string | null {
  if (invalidPlaceholders(part).length) return "Not a valid placeholder. Use {{args.name}} or {{inputs.id}}.";
  const reference = REFERENCE.exec(part);
  if (!scope || !reference) return null;
  const [, kind, name] = reference;
  const declared = kind === "args" ? scope.args.includes(name) : scope.inputs.some((input) => input.id === name);
  return declared ? null : `${kind}.${name} is not declared.`;
}

/** Text with each {{…}} placeholder highlighted; invalid or undeclared ones are flagged in the error color. */
export function TemplateText({ value }: { value: string }) {
  const scope = useContext(TemplateScopeContext);
  return (
    <>
      {value.split(PLACEHOLDER).map((part, index) =>
        index % 2 ? (
          <span
            className={cn(
              "rounded-sm",
              problemWith(part, scope) ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
            )}
            key={index}
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const suggestionLabel = (suggestion: TemplateSuggestion) =>
  suggestion.type === "existing"
    ? `${suggestion.kind}.${suggestion.name}`
    : `Create ${suggestion.kind === "args" ? "argument" : suggestion.secret ? "secret" : "input"} “${suggestion.name}”`;

/** Sets a controlled input's value the way typing would, so the owner's onChange runs. */
function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Single-line input that highlights {{…}} placeholders. The real input keeps focus, caret, selection and
 * styling with transparent text; a non-interactive mirror on top draws the coloured text and follows its scroll.
 * Typing `{{` opens suggestions from the surrounding TemplateScopeProvider, including creating a missing name.
 */
export function TemplateInput({
  className,
  wrapperClassName,
  value,
  ...props
}: Omit<ComponentProps<typeof Input>, "value"> & { value: string; wrapperClassName?: string }) {
  const scope = useContext(TemplateScopeContext);
  const listId = useId();
  const mirror = useRef<HTMLSpanElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [completion, setCompletion] = useState<TemplateCompletion | null>(null);
  const [active, setActive] = useState(0);
  const follow = (input: HTMLInputElement) => {
    if (mirror.current) mirror.current.scrollLeft = input.scrollLeft;
  };
  const refresh = (input: HTMLInputElement) => {
    const caret = input.selectionStart;
    const next =
      scope && !input.disabled && caret !== null && caret === input.selectionEnd
        ? templateCompletion(input.value, caret, scope)
        : null;
    setCompletion(next);
    setActive(0);
  };
  const choose = (suggestion: TemplateSuggestion) => {
    const input = field.current;
    if (!input || !completion) return;
    const applied = applyTemplateSuggestion(input.value, completion, suggestion);
    if (suggestion.type === "create") {
      if (suggestion.kind === "args") scope?.createArg?.(suggestion.name);
      else scope?.createInput?.(suggestion.name, suggestion.secret);
    }
    setInputValue(input, applied.value);
    input.setSelectionRange(applied.caret, applied.caret);
    setCompletion(null);
  };
  const open = completion !== null;
  return (
    <Popover.Root onOpenChange={(next) => !next && setCompletion(null)} open={open}>
      <Popover.Anchor asChild>
        <span className={cn("relative block min-w-0", wrapperClassName)}>
          <Input
            {...props}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            aria-autocomplete={scope ? "list" : undefined}
            aria-controls={open ? listId : undefined}
            aria-expanded={scope ? open : undefined}
            className={cn("text-transparent caret-foreground", className)}
            onBlur={(event) => {
              setCompletion(null);
              props.onBlur?.(event);
            }}
            onChange={(event) => {
              props.onChange?.(event);
              refresh(event.currentTarget);
            }}
            onClick={(event) => {
              props.onClick?.(event);
              refresh(event.currentTarget);
            }}
            onKeyDown={(event) => {
              props.onKeyDown?.(event);
              if (!completion || event.defaultPrevented || event.nativeEvent.isComposing) return;
              const count = completion.suggestions.length;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
              } else if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                choose(completion.suggestions[active]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setCompletion(null);
              }
            }}
            onKeyUp={(event) => {
              props.onKeyUp?.(event);
              follow(event.currentTarget);
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "Home" ||
                event.key === "End"
              )
                refresh(event.currentTarget);
            }}
            onScroll={(event) => follow(event.currentTarget)}
            onSelect={(event) => follow(event.currentTarget)}
            ref={field}
            role={scope ? "combobox" : undefined}
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
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          className="z-50 w-[min(24rem,var(--radix-popover-content-available-width))] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          sideOffset={4}
        >
          <ul aria-label="Placeholder suggestions" className="max-h-64 overflow-y-auto" id={listId} role="listbox">
            {completion?.suggestions.map((suggestion, index) => (
              <li
                aria-selected={index === active}
                className={cn(
                  "flex cursor-default flex-col rounded-md px-3 py-1.5 select-none",
                  index === active && "bg-accent text-accent-text",
                )}
                id={`${listId}-${index}`}
                key={`${suggestion.type}-${suggestion.kind}-${suggestion.name}-${suggestion.type === "create" && suggestion.secret}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(suggestion);
                }}
                onMouseEnter={() => setActive(index)}
                role="option"
              >
                <span className={cn("text-[13px]", suggestion.type === "existing" && "font-mono")}>
                  {suggestionLabel(suggestion)}
                </span>
                <span className="text-xs text-muted-foreground">{suggestion.detail}</span>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
