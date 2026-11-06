"use client";

import {
  AlertBanner,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/components/ui/index.tsx";
import { schemaTextError } from "./agentForm";
import { errorAt, JsonEditor, type ToolSectionProps } from "./ToolDefinitionSections";
import { LanguageSelect } from "./ToolRequestSection";
import { starterSource, type ToolForm } from "./toolForm";

/** One picker over parser + mode: "schema" = JSON parse then validate. */
type OutputChoice = ToolForm["parser"] | "schema";

const OUTPUT_OPTIONS: { value: OutputChoice; label: string; help: string }[] = [
  { value: "auto", label: "Freeform", help: "Sent to the model as-is: JSON if the result parses, otherwise text." },
  {
    value: "schema",
    label: "JSON matching a schema",
    help: "Must be JSON matching the schema below, or the model gets an error.",
  },
  { value: "json", label: "JSON", help: "Must be JSON, or the model gets an error." },
  { value: "text", label: "Plain text", help: "The raw result as text." },
  {
    value: "html-text",
    label: "Readable text from HTML",
    help: "Tags, scripts and styles removed. Good for web pages.",
  },
  { value: "code", label: "Code transform", help: "Your code reshapes the raw result before the model sees it." },
];

const choiceOf = (form: ToolForm): OutputChoice =>
  form.outputMode === "schema" && form.parser !== "code" ? "schema" : form.parser;

const patchFor = (choice: OutputChoice, form: ToolForm): Partial<ToolForm> =>
  choice === "schema"
    ? { parser: "json", outputMode: "schema" }
    : { parser: choice, outputMode: choice === "code" ? form.outputMode : "freeform" };

export function OutputFields({
  form,
  set,
  errors,
  disabled,
  codeConfigured,
}: ToolSectionProps & { codeConfigured: boolean }) {
  const transformError = errorAt(errors, "output.transform");
  const schemaError = errorAt(errors, "output.schema") ?? schemaTextError(form.schemaText);
  const choice = choiceOf(form);
  const option = OUTPUT_OPTIONS.find((item) => item.value === choice);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <Field description={option?.help} htmlFor="tool-output" label="Output">
          <Select
            disabled={disabled}
            onValueChange={(value) => set(patchFor(value as OutputChoice, form))}
            value={choice}
          >
            <SelectTrigger className="w-full" id="tool-output">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {form.kind === "http" ? (
          <Field
            description="Applied before the output step. Blank keeps the whole response."
            error={errorAt(errors, "http.responsePath")}
            htmlFor="tool-response-path"
            label="Response path"
          >
            <Input
              className="font-mono"
              disabled={disabled}
              maxLength={200}
              onChange={(e) => set({ responsePath: e.target.value })}
              placeholder="data.items"
              value={form.responsePath}
            />
          </Field>
        ) : null}
      </div>

      {form.parser === "code" ? (
        <div className="grid gap-2">
          {codeConfigured ? null : (
            <AlertBanner variant="warning">
              Code execution is not configured on this server, so the transform cannot run.
            </AlertBanner>
          )}
          <div className="overflow-hidden rounded-lg border border-input">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
              <div className="w-52">
                <LanguageSelect
                  disabled={disabled}
                  id="tool-transform-language"
                  onChange={(transformLanguage) =>
                    set(
                      form.transformSource === starterSource(form.transformLanguage, true)
                        ? { transformLanguage, transformSource: starterSource(transformLanguage, true) }
                        : { transformLanguage },
                    )
                  }
                  value={form.transformLanguage}
                />
              </div>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Stdin: {'{ "body", "status", "headers" }'} for HTTP, {'{ "stdout" }'} for code. Print the result.
              </p>
              <label className="flex items-center gap-2 text-xs font-medium">
                <Switch
                  checked={form.outputMode === "schema"}
                  disabled={disabled}
                  onCheckedChange={(checked) => set({ outputMode: checked ? "schema" : "freeform" })}
                  size="sm"
                />
                Validate with schema
              </label>
            </div>
            <JsonEditor
              className="h-60 rounded-none border-0"
              disabled={disabled}
              label="Transform"
              language={form.transformLanguage}
              onChange={(transformSource) => set({ transformSource })}
              value={form.transformSource}
            />
          </div>
          {transformError ? (
            <p className="text-xs text-destructive" role="alert">
              {transformError}
            </p>
          ) : null}
        </div>
      ) : null}

      {form.outputMode === "schema" ? (
        <Field error={schemaError} htmlFor="tool-output-schema" label='Output schema (root { "type": "object" })'>
          <div>
            <JsonEditor
              className={form.parser === "code" ? "h-56" : "h-[min(24rem,calc(100dvh-26rem))] min-h-56"}
              disabled={disabled}
              label="Output schema"
              onChange={(schemaText) => set({ schemaText })}
              value={form.schemaText}
            />
          </div>
        </Field>
      ) : null}
    </div>
  );
}
