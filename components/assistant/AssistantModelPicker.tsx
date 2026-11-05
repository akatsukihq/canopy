"use client";

import { useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from "@/components/ui/index.tsx";
import type { AIEffort } from "@/lib/ai/types";
import type { AssistantModels } from "@/lib/assistant/types";
import type { AssistantModelChoice } from "@/lib/assistant/useAssistant";

const EFFORT_LABEL: Record<AIEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Max",
};
// Compact rows on desktop pointers; touch keeps the menu's larger hit targets.
// Hover and an open submenu use a neutral tint so only the current pick shows the accent.
const ROW =
  "text-xs! [@media(pointer:fine)]:min-h-7! px-2! data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground";
const CURRENT =
  "bg-accent font-medium text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";
const LABEL = "px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase";
const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", compatible: "Models" };

/** The effort a run gets: the pick or agent default, or the model's highest when it lacks that level. */
function effectiveEffort(levels: readonly AIEffort[], wanted: AIEffort) {
  return levels.includes(wanted) ? wanted : levels.at(-1);
}

type Props = {
  models: AssistantModels;
  choice: AssistantModelChoice;
  /** The selected agent's effort, used while the user has not picked one. */
  defaultEffort: AIEffort;
  disabled?: boolean;
  onChange: (choice: AssistantModelChoice) => void;
};

export function AssistantModelPicker({ models, choice, defaultEffort, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const current = models.models.find((entry) => entry.id === choice.model) ??
    models.models.find((entry) => entry.id === models.defaultModel) ?? { id: models.defaultModel, name: models.defaultModel, efforts: [] };
  const wanted = choice.effort ?? defaultEffort;
  const effort = effectiveEffort(current.efforts, wanted);
  const label = `${current.name}${effort ? ` · ${EFFORT_LABEL[effort]}` : ""}`;
  const needle = query.trim().toLowerCase();
  const shown = models.models.filter(
    (entry) => !needle || entry.id.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle),
  );
  // The admin default is stored as "no choice", so a later admin change still applies.
  const pickModel = (id: string) => ({ ...choice, model: id === models.defaultModel ? undefined : id });
  const pickEffort = (id: string, level: AIEffort) =>
    onChange({ ...pickModel(id), effort: level === defaultEffort ? undefined : level });

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        if (next) requestAnimationFrame(() => search.current?.focus());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 max-w-56 gap-1 px-2 text-xs font-normal text-muted-foreground"
          disabled={disabled}
          aria-label={`Model and effort: ${label}`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" size="sm" className="flex w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0">
        <div className="p-1.5">
          <Input
            ref={search}
            size="sm"
            value={query}
            placeholder="Search models…"
            aria-label="Search models"
            leadingIcon={<Search className="size-3.5" aria-hidden="true" />}
            onChange={(event) => setQuery(event.target.value)}
            // Typing stays in the field; arrows and Escape still drive the menu.
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) event.stopPropagation();
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto px-1 pb-1">
          <p className={LABEL}>
            {PROVIDER_LABEL[models.provider] ?? models.provider}
          </p>
          {shown.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No models match.</p>}
          {shown.map((entry) => {
            const selected = entry.id === current.id;
            const active = selected ? effort : effectiveEffort(entry.efforts, wanted);
            const rowClass = selected ? `${ROW} ${CURRENT}` : ROW;
            const name = (
              <>
                <span className="flex-1 truncate">{entry.name}</span>
                {active && <span className="font-normal text-muted-foreground">{EFFORT_LABEL[active]}</span>}
              </>
            );
            if (!entry.efforts.length)
              return (
                <DropdownMenuItem
                  key={entry.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  className={rowClass}
                  onSelect={() => onChange(pickModel(entry.id))}
                >
                  {name}
                </DropdownMenuItem>
              );
            return (
              <DropdownMenuSub key={entry.id}>
                <DropdownMenuSubTrigger
                  aria-current={selected || undefined}
                  className={rowClass}
                  // Clicking the row picks the model at its current effort; the arrow's submenu changes effort.
                  onClick={(event) => {
                    event.preventDefault();
                    onChange(pickModel(entry.id));
                    setOpen(false);
                  }}
                >
                  {name}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={6} className="w-max">
                  <p className={LABEL}>
                    Effort
                  </p>
                  {entry.efforts.map((level) => (
                    <DropdownMenuItem
                      key={level}
                      role="menuitemradio"
                      aria-checked={level === active}
                      className={level === active ? `${ROW} ${CURRENT}` : ROW}
                      onSelect={() => pickEffort(entry.id, level)}
                    >
                      <span className="flex-1">{EFFORT_LABEL[level]}</span>
                      {level === defaultEffort && <span className="font-normal text-muted-foreground">Default</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
