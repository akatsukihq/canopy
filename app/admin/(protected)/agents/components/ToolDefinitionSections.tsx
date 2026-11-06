"use client";

import { CodeEditor } from "@/components/content/CodeEditor";
import {
  Button,
  Checkbox,
  Field,
  Input,
  OrderableList,
  type OrderableItemState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { TOOL_INPUT_TYPES } from "@/lib/agents/toolTypes.ts";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { schemaTextError } from "./agentForm";
import { FormSection } from "./FormSection";
import { follows, idFromLabel, isNewRow, keyFromName, type InputFieldForm, type ToolForm } from "./toolForm";

export type ToolSectionProps = {
  form: ToolForm;
  set: (patch: Partial<ToolForm>) => void;
  errors: Record<string, string>;
  disabled: boolean;
};

/** First error at or below a dot path. */
export const errorAt = (errors: Record<string, string>, path: string) =>
  errors[path] ?? Object.entries(errors).find(([key]) => key.startsWith(`${path}.`))?.[1];

const TYPE_LABELS: Record<InputFieldForm["type"], string> = {
  text: "Text",
  secret: "Secret",
  url: "URL",
  number: "Number",
  json: "JSON",
};

export function JsonEditor({
  label,
  value,
  onChange,
  disabled,
  language = "json",
  className = "h-56",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  language?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-input", className)}>
      <CodeEditor aria-label={label} disabled={disabled} language={language} onChange={onChange} value={value} />
    </div>
  );
}

export function HeaderSwitch({
  checked,
  onChange,
  disabled,
  label,
  help,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  label: string;
  help: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} size="sm" />
          {label}
        </label>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{help}</TooltipContent>
    </Tooltip>
  );
}

/** `autoKey`: a new tool's key follows its name until edited by hand. */
export function DefinitionSection({ form, set, errors, disabled, autoKey }: ToolSectionProps & { autoKey: boolean }) {
  return (
    <FormSection
      actions={
        <TooltipProvider>
          <div className="flex items-center gap-4">
            <HeaderSwitch
              checked={form.enabled}
              disabled={disabled}
              help="Disabled tools are skipped when agents run."
              label="Enabled"
              onChange={(enabled) => set({ enabled })}
            />
            <HeaderSwitch
              checked={form.requiresApproval}
              disabled={disabled}
              help="The person approves each call before it runs. Use it for calls that change data. Not allowed for blog generation agents."
              label="Requires approval"
              onChange={(requiresApproval) => set({ requiresApproval })}
            />
          </div>
        </TooltipProvider>
      }
      title="Definition"
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="grid content-start gap-4">
          <Field error={errors.name} htmlFor="tool-name" label="Name" required>
            <Input
              disabled={disabled}
              maxLength={80}
              onChange={(e) => {
                const name = e.target.value;
                set(autoKey && follows(form.key, form.name, keyFromName) ? { name, key: keyFromName(name) } : { name });
              }}
              placeholder="Web search"
              value={form.name}
            />
          </Field>
          <Field
            description={
              <>
                Model sees <code className="font-mono">custom_{form.key || "<key>"}</code>
              </>
            }
            error={errors.key}
            htmlFor="tool-key"
            label="Key"
            required
          >
            <Input
              className="font-mono"
              disabled={disabled}
              maxLength={48}
              onChange={(e) => set({ key: e.target.value })}
              placeholder="web_search"
              value={form.key}
            />
          </Field>
        </div>
        <Field
          className="md:grid-rows-[auto_minmax(0,1fr)_auto]"
          description={`${form.description.length}/1000 · The model reads this to decide when to call the tool. Say what it does and returns.`}
          error={errors.description}
          htmlFor="tool-description"
          label="Description"
          required
        >
          <Textarea
            className="min-h-[88px] md:h-full"
            disabled={disabled}
            maxLength={1000}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Searches the web and returns the top results with title, URL and snippet."
            value={form.description}
          />
        </Field>
      </div>
    </FormSection>
  );
}

export function ArgumentsFields({ form, set, errors, disabled }: ToolSectionProps) {
  return (
    <Field
      description='JSON Schema for what the model passes, root { "type": "object" }. Describe each property; use {{args.name}} in the request.'
      error={errors.argsSchema ?? schemaTextError(form.argsText)}
      htmlFor="tool-args"
      label="Arguments schema"
    >
      <div>
        <JsonEditor
          className="h-[min(26rem,calc(100dvh-24rem))] min-h-56"
          disabled={disabled}
          label="Arguments schema"
          onChange={(argsText) => set({ argsText })}
          value={form.argsText}
        />
      </div>
    </Field>
  );
}

const TYPE_PLACEHOLDERS: Partial<Record<InputFieldForm["type"], string>> = {
  json: '{"region": "eu"}',
  number: "10",
  url: "https://api.example.com",
};

const blankField = (type: InputFieldForm["type"]): InputFieldForm => ({
  rowKey: crypto.randomUUID(),
  id: "",
  label: "",
  type,
  required: type === "secret",
  defaultValue: "",
  description: "",
});

const ROW_COLUMNS = {
  inputs: "grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem_minmax(0,1fr)_4rem_2rem]",
  secrets: "grid-cols-[2rem_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_4rem_2rem]",
};

const GROUP_COPY = {
  inputs: {
    intro: (
      <>
        Settings such as a base URL, region or result limit. You declare them here;{" "}
        <strong className="font-medium text-foreground">
          each agent enters its value on its own page, under Custom tools
        </strong>
        , or leaves the default. To try the tool now, type values in the Test panel. Use{" "}
        <code className="font-mono">{"{{inputs.id}}"}</code> in the request; a JSON input like{" "}
        <code className="font-mono">{"{{inputs.filters}}"}</code> is sent as an object, and{" "}
        <code className="font-mono">{"{{inputs.filters.region}}"}</code> reads one field. The model never sees or sets
        these; it only passes arguments.
      </>
    ),
    empty: "No inputs. Add one for a per-agent setting such as a base URL.",
    noun: "input",
    headers: ["Label", "Id", "Type", "Default"],
  },
  secrets: {
    intro: (
      <>
        API keys and tokens. Where the value goes:{" "}
        <strong className="font-medium text-foreground">
          a Shared value here is used by every agent; an agent can enter its own on its page, under Custom tools, to
          override it
        </strong>
        . Leave Shared value empty to make each agent bring its own key. Values are encrypted, never shown again and
        never sent to the model. Use <code className="font-mono">{"{{inputs.id}}"}</code> in a header, e.g.{" "}
        <code className="font-mono">{"Bearer {{inputs.apiKey}}"}</code>.
      </>
    ),
    empty: "No secrets. Add one when the API needs a key or token.",
    noun: "secret",
    headers: ["Label", "Id", "Shared value"],
  },
} as const;

/** Saved values never come back: blank keeps the saved one, Clear removes it. */
function SharedValue({
  name,
  saved,
  value,
  disabled,
  onChange,
}: {
  name: string;
  saved: boolean;
  value: string | undefined;
  disabled: boolean;
  /** undefined keeps the saved value; "" clears it. */
  onChange: (value: string | undefined) => void;
}) {
  const cleared = saved && value === "";
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={`Shared value for ${name}`}
        autoComplete="new-password"
        disabled={disabled}
        maxLength={4000}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={cleared ? "Cleared — agents enter their own" : saved ? "Saved — blank keeps it" : "Optional"}
        type="password"
        value={value ?? ""}
      />
      {saved && !value ? (
        <Button
          disabled={disabled}
          onClick={() => onChange(cleared ? undefined : "")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {cleared ? "Undo" : "Clear"}
        </Button>
      ) : null}
    </div>
  );
}

function DragHandle({ label, state }: { label: string; state: OrderableItemState }) {
  return (
    <Button
      aria-label={`Reorder ${label}`}
      className="cursor-grab text-muted-foreground active:cursor-grabbing"
      disabled={state.disabled}
      ref={state.setActivatorNodeRef}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...state.attributes}
      {...state.listeners}
    >
      <GripVertical aria-hidden="true" />
    </Button>
  );
}

/** Inputs or secrets of the tool: both live in form.inputs, split by type="secret". */
export function InputsFields({
  form,
  set,
  errors,
  disabled,
  group,
}: {
  /** A tool or a connection form: anything holding input rows, plus shared secret values. */
  form: { inputs: InputFieldForm[]; secretValues: Record<string, string>; savedSecretValues: string[] };
  set: (patch: { inputs?: InputFieldForm[]; secretValues?: Record<string, string> }) => void;
  errors: Record<string, string>;
  disabled: boolean;
  group: "inputs" | "secrets";
}) {
  const isSecret = (field: InputFieldForm) => field.type === "secret";
  const rows = form.inputs.filter((field) => isSecret(field) === (group === "secrets"));
  const others = form.inputs.filter((field) => isSecret(field) !== (group === "secrets"));
  const copy = GROUP_COPY[group];
  const columns = cn("grid items-start gap-2", ROW_COLUMNS[group]);
  const update = (rowKey: string, patch: Partial<InputFieldForm>) =>
    set({ inputs: form.inputs.map((field) => (field.rowKey === rowKey ? { ...field, ...patch } : field)) });
  const reorder = (next: InputFieldForm[]) =>
    set({ inputs: group === "secrets" ? [...others, ...next] : [...next, ...others] });

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{copy.intro}</p>
      {errors.inputs ? (
        <p className="text-xs text-destructive" role="alert">
          {errors.inputs}
        </p>
      ) : null}
      <div className="-mx-4 -mb-4 border-t border-border">
        {rows.length === 0 ? (
          <p className="border-b border-border p-4 text-center text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <div
            aria-hidden="true"
            className={cn(
              columns,
              "border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground",
            )}
          >
            <span />
            {copy.headers.map((header) => (
              <span key={header}>{header}</span>
            ))}
            <span className="text-center">Required</span>
            <span />
          </div>
        )}
        <OrderableList
          ariaLabel={group === "secrets" ? "Secrets" : "Inputs"}
          className="divide-y divide-border border-b border-border empty:hidden"
          disabled={disabled}
          getId={(field) => field.rowKey}
          getLabel={(field) => field.label || copy.noun}
          items={rows}
          onReorder={reorder}
          renderItem={(field, state) => {
            const index = form.inputs.indexOf(field);
            const name = field.label || `${copy.noun} ${rows.indexOf(field) + 1}`;
            const rowErrors = ["label", "id", "defaultValue"]
              .map((key) => errorAt(errors, `inputs.${index}.${key}`))
              .filter(Boolean);
            return (
              <div className={cn("grid gap-1 px-3 py-2", state.isDragging ? "bg-accent shadow-sm" : "bg-card")}>
                <div className={columns}>
                  <div className="flex h-9 items-center">
                    <DragHandle label={name} state={state} />
                  </div>
                  <Input
                    aria-invalid={Boolean(errorAt(errors, `inputs.${index}.label`))}
                    aria-label={`Label for ${copy.noun} ${rows.indexOf(field) + 1}`}
                    disabled={disabled}
                    maxLength={80}
                    onChange={(e) => {
                      const label = e.target.value;
                      update(
                        field.rowKey,
                        isNewRow(field) && follows(field.id, field.label, idFromLabel)
                          ? { label, id: idFromLabel(label) }
                          : { label },
                      );
                    }}
                    placeholder={group === "secrets" ? "API key" : "Base URL"}
                    value={field.label}
                  />
                  <Input
                    aria-invalid={Boolean(errorAt(errors, `inputs.${index}.id`))}
                    aria-label={`Id for ${name}`}
                    className="font-mono"
                    disabled={disabled}
                    maxLength={64}
                    onChange={(e) => update(field.rowKey, { id: e.target.value })}
                    placeholder={group === "secrets" ? "apiKey" : "baseUrl"}
                    value={field.id}
                  />
                  {group === "secrets" ? (
                    <SharedValue
                      disabled={disabled}
                      name={name}
                      onChange={(value) => {
                        const { [field.id]: _previous, ...rest } = form.secretValues;
                        set({ secretValues: value === undefined ? rest : { ...rest, [field.id]: value } });
                      }}
                      saved={form.savedSecretValues.includes(field.id)}
                      value={form.secretValues[field.id]}
                    />
                  ) : null}
                  {group === "inputs" ? (
                    <>
                      <Select
                        disabled={disabled}
                        onValueChange={(type) => update(field.rowKey, { type: type as InputFieldForm["type"] })}
                        value={field.type}
                      >
                        <SelectTrigger aria-label={`Type of ${name}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TOOL_INPUT_TYPES.filter((type) => type !== "secret").map((type) => (
                            <SelectItem key={type} value={type}>
                              {TYPE_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-invalid={Boolean(errorAt(errors, `inputs.${index}.defaultValue`))}
                        aria-label={`Default value for ${name}`}
                        className={field.type === "json" ? "font-mono" : undefined}
                        disabled={disabled}
                        onChange={(e) => update(field.rowKey, { defaultValue: e.target.value })}
                        placeholder={TYPE_PLACEHOLDERS[field.type] ?? "Optional"}
                        value={field.defaultValue}
                      />
                    </>
                  ) : null}
                  <Checkbox
                    checked={field.required}
                    className="min-h-9 items-center justify-center"
                    disabled={disabled}
                    label={<span className="sr-only">{name} is required</span>}
                    onCheckedChange={(checked) => update(field.rowKey, { required: checked === true })}
                  />
                  <div className="flex h-9 items-center">
                    <Button
                      aria-label={`Remove ${name}`}
                      disabled={disabled}
                      onClick={() => set({ inputs: form.inputs.filter((item) => item.rowKey !== field.rowKey) })}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <Input
                  aria-label={`Help text for ${name}`}
                  className="ml-10 h-7 w-[calc(100%-2.5rem)] border-transparent bg-transparent px-2 text-xs shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
                  disabled={disabled}
                  maxLength={300}
                  onChange={(e) => update(field.rowKey, { description: e.target.value })}
                  placeholder="Add help text shown to the agent (optional)"
                  value={field.description}
                />
                {rowErrors.length ? (
                  <p className="ml-10 text-xs text-destructive" role="alert">
                    {rowErrors.join(" ")}
                  </p>
                ) : null}
              </div>
            );
          }}
        />
        <div className="px-2 py-1">
          <Button
            disabled={disabled}
            onClick={() => set({ inputs: [...form.inputs, blankField(group === "secrets" ? "secret" : "text")] })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" /> Add {copy.noun}
          </Button>
        </div>
      </div>
    </div>
  );
}
