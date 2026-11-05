"use client";

import {
  Button,
  Caption,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@/components/ui/index.tsx";
import { Braces } from "lucide-react";
import { useState } from "react";

const PLACEHOLDER_NAME = /^[A-Za-z_][\w.]*$/;

export const EXPAND_BUTTON = "group/btn gap-0";

/**
 * Icon-only until the button is hovered, focused or open, then the label opens
 * to its real width. The 0fr -> 1fr grid column animates to the content width
 * (max-width would animate to a guessed value); padding sits on the inner span
 * so the collapsed state is exactly zero wide.
 */
export function ExpandLabel({ children }: { children: string }) {
  return (
    <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[1fr] group-focus-visible/btn:grid-cols-[1fr] group-data-[state=open]/btn:grid-cols-[1fr] motion-reduce:transition-none">
      <span className="min-w-0 overflow-hidden">
        <span className="block pl-2 whitespace-nowrap opacity-0 transition-opacity duration-150 ease-out group-hover/btn:opacity-100 group-hover/btn:delay-100 group-hover/btn:duration-200 group-focus-visible/btn:opacity-100 group-data-[state=open]/btn:opacity-100">
          {children}
        </span>
      </span>
    </span>
  );
}

export function PlaceholderMenu({
  names,
  onInsert,
  allowCustom = true,
}: {
  names: readonly string[];
  onInsert: (name: string) => void;
  /** Offer a field for typing a new name; translations may only reuse the English names. */
  allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const valid = PLACEHOLDER_NAME.test(custom);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={EXPAND_BUTTON} size="sm" type="button" variant="outline">
          <Braces aria-hidden="true" />
          <ExpandLabel>Insert placeholder</ExpandLabel>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={(event) => event.preventDefault()}>
        {names.length ? (
          names.map((name) => (
            <DropdownMenuItem key={name} onSelect={() => onInsert(name)}>
              <span className="rounded bg-accent px-1.5 font-mono text-xs text-primary">{name}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <Caption className="px-2 py-1.5 text-muted-foreground">No placeholders in this spec yet.</Caption>
        )}
        {allowCustom ? <DropdownMenuSeparator /> : null}
        {allowCustom ? (
          <div className="flex gap-2 p-1" onKeyDown={(event) => event.stopPropagation()}>
            <Input
              aria-invalid={custom !== "" && !valid}
              aria-label="New placeholder name"
              className="h-8"
              onChange={(event) => setCustom(event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter" && valid) {
                  event.preventDefault();
                  onInsert(custom);
                  setCustom("");
                }
              }}
              placeholder="newName"
              value={custom}
            />
            <Button
              disabled={!valid}
              onClick={() => {
                onInsert(custom);
                setCustom("");
              }}
              size="sm"
              type="button"
            >
              Add
            </Button>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
