"use client";

import { CodeEditor } from "@/components/content/CodeEditor";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Checkbox,
  Field,
  Label,
  RadioGroup,
  RadioGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import { Maximize2, X } from "lucide-react";
import type { ReactNode } from "react";
import { schemaTextError } from "./agentForm";
import { FormSection, type SectionProps } from "./FormSection";

const OUTPUT_MODES = [
  { value: "text", title: "Text", help: "A free-form answer." },
  { value: "structured", title: "Structured", help: "The answer must match a JSON Schema." },
] as const;

function editor(
  label: string,
  value: string,
  onChange: (value: string) => void,
  disabled?: boolean,
  toolbar?: ReactNode,
) {
  return (
    <CodeEditor
      aria-label={label}
      disabled={disabled}
      language="json"
      onChange={onChange}
      toolbar={toolbar}
      value={value}
    />
  );
}

export function OutputSection({ form, set, errors, disabled }: SectionProps) {
  const error = errors.outputSchema ?? (form.outputMode === "structured" ? schemaTextError(form.schemaText) : null);
  const expand = (
    <AlertDialog>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <Button
                aria-label="Open full-size editor"

                size="icon-xs"
                type="button"
                variant="input-icon"
              >
                <Maximize2 aria-hidden="true" />
              </Button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Open full-size editor</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AlertDialogContent
        aria-describedby="agent-schema-help"
        aria-label="JSON Schema editor"
        className="flex h-[min(52rem,calc(100dvh-4rem))] w-[calc(100%-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-6xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <AlertDialogTitle>JSON Schema</AlertDialogTitle>
            <AlertDialogDescription className="mt-1" id="agent-schema-help">
              The root must be {'{ "type": "object" }'}. Changes apply to the agent form as you type.
            </AlertDialogDescription>
          </div>
          <AlertDialogCancel aria-label="Close JSON editor" size="icon" variant="ghost">
            <X aria-hidden="true" />
          </AlertDialogCancel>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {editor("JSON Schema", form.schemaText, (schemaText) => set({ schemaText }), disabled)}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-border px-4 py-4 sm:px-6">
          <AlertDialogCancel type="button" variant="secondary">
            Done
          </AlertDialogCancel>
        </footer>
      </AlertDialogContent>
    </AlertDialog>
  );
  return (
    <FormSection description="What shape the agent's answer takes." title="Output">
      <RadioGroup
        aria-label="Answer format"
        className="grid gap-2 sm:grid-cols-2"
        disabled={disabled}
        onValueChange={(mode) => set({ outputMode: mode as "text" | "structured" })}
        value={form.outputMode}
      >
        {OUTPUT_MODES.map((mode) => (
          <Label
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent/40"
            htmlFor={`output-${mode.value}`}
            key={mode.value}
          >
            <RadioGroupItem className="mt-0.5" id={`output-${mode.value}`} value={mode.value} />
            <span className="grid gap-0.5">
              <span className="text-sm font-semibold">{mode.title}</span>
              <span className="text-xs font-normal text-muted-foreground">{mode.help}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {form.outputMode === "structured" ? (
        <Field
          description='The root must be { "type": "object" }. The name "document" is reserved.'
          error={error}
          htmlFor="agent-schema"
          label="JSON Schema"
        >
          <div className="relative h-64 overflow-hidden rounded-lg border border-input">
            {editor("JSON Schema", form.schemaText, (schemaText) => set({ schemaText }), disabled, expand)}
          </div>
        </Field>
      ) : null}
      <Checkbox
        checked={form.proposesDocument}
        description="The agent can return a full article (title, excerpt, body, SEO fields) that the editor previews before applying."
        disabled={disabled}
        label="Can propose article changes"
        onCheckedChange={(checked) => set({ proposesDocument: checked === true })}
      />
      <Checkbox
        checked={form.requiresDocument}
        description="The agent will not run unless the person has an article open."
        disabled={disabled}
        label="Requires an open article"
        onCheckedChange={(checked) => set({ requiresDocument: checked === true })}
      />
    </FormSection>
  );
}
