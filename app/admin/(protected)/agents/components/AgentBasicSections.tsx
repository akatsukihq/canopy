"use client";

import {
  Checkbox,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@/components/ui/index.tsx";
import { AI_EFFORTS } from "@/lib/ai/types.ts";
import { AGENT_SECTION_LABELS, AGENT_SECTIONS } from "@/lib/agents/types.ts";
import { toggle } from "./agentForm";
import { FormSection, SectionLink, type SectionProps } from "./FormSection";

export function IdentitySection({ form, set, errors, disabled }: SectionProps) {
  return (
    <FormSection description="How the agent is named and how people invoke it." title="Identity">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field description="Shown in agent pickers." error={errors.name} htmlFor="agent-name" label="Name" required>
          <Input disabled={disabled} maxLength={80} onChange={(e) => set({ name: e.target.value })} value={form.name} />
        </Field>
        <Field
          description="Lowercase letters, numbers, hyphens."
          error={errors.key}
          htmlFor="agent-key"
          label="Key"
          required
        >
          <Input disabled={disabled} maxLength={64} onChange={(e) => set({ key: e.target.value })} value={form.key} />
        </Field>
      </div>
      <Field
        description="One sentence on what this agent does. Up to 300 characters."
        error={errors.description}
        htmlFor="agent-description"
        label="Description"
        required
      >
        <Textarea
          className="min-h-14"
          disabled={disabled}
          maxLength={300}
          onChange={(e) => set({ description: e.target.value })}
          rows={2}
          value={form.description}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          description="Typed after a slash. Empty for none."
          error={errors.command}
          htmlFor="agent-command"
          label="Command"
        >
          <Input
            disabled={disabled}
            maxLength={32}
            onChange={(e) => set({ command: e.target.value })}
            placeholder="plan"
            value={form.command}
          />
        </Field>
        <Field
          description="Other names, separated by commas."
          error={errors.aliases}
          htmlFor="agent-aliases"
          label="Aliases"
        >
          <Input disabled={disabled} onChange={(e) => set({ aliases: e.target.value })} value={form.aliases} />
        </Field>
      </div>
    </FormSection>
  );
}

export function PersonaSection({ form, set, errors, disabled }: SectionProps) {
  return (
    <FormSection
      description="The agent's role and instructions, written in Markdown. Safety rules are added by the platform."
      title="Persona"
    >
      <Field error={errors.persona} htmlFor="agent-persona" label={<span className="sr-only">Persona</span>}>
        <Textarea
          className="min-h-64 whitespace-pre-wrap rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 [overflow-wrap:anywhere]"
          code
          disabled={disabled}
          onChange={(e) => set({ persona: e.target.value })}
          value={form.persona}
        />
      </Field>
    </FormSection>
  );
}

const DEFAULT_MODEL = "__default__";

export function ModelSection({
  form,
  set,
  errors,
  disabled,
  models,
  defaultModel,
}: SectionProps & { models: readonly string[]; defaultModel: string }) {
  // A saved model the provider no longer lists must stay visible so saving does not silently change it.
  const choices = form.model && !models.includes(form.model) ? [form.model, ...models] : models;
  return (
    <FormSection actions={<SectionLink href="/admin/settings/ai">AI settings</SectionLink>} title="Model">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          description={
            models.length
              ? "Leave on the default to follow the platform setting."
              : "Provider model id. The model list could not be loaded, so type it. Leave empty for the platform default."
          }
          error={errors.model}
          htmlFor="agent-model"
          label="Model"
        >
          {models.length ? (
            <Select
              disabled={disabled}
              onValueChange={(model) => set({ model: model === DEFAULT_MODEL ? "" : model })}
              value={form.model || DEFAULT_MODEL}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>
                  {defaultModel ? `Platform default (${defaultModel})` : "Platform default"}
                </SelectItem>
                {choices.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              disabled={disabled}
              maxLength={120}
              onChange={(e) => set({ model: e.target.value })}
              value={form.model}
            />
          )}
        </Field>
        <Field
          description="Higher effort thinks longer and costs more."
          error={errors.effort}
          htmlFor="agent-effort"
          label="Effort"
        >
          <Select
            disabled={disabled}
            onValueChange={(effort) => set({ effort: effort as typeof form.effort })}
            value={form.effort}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_EFFORTS.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </FormSection>
  );
}

export function AvailabilitySection({ form, set, errors, disabled }: SectionProps) {
  return (
    <FormSection description="Where this agent appears." title="Availability">
      <fieldset disabled={disabled}>
        <legend className="sr-only">Sections</legend>
        <div className="-mx-4 -mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] border-b border-border">
          <span className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
            Section
          </span>
          <span className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
            Available
          </span>
          <span className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
            Default
          </span>
          {AGENT_SECTIONS.map((section, index) => {
            const on = form.sections.includes(section);
            const cell = index === AGENT_SECTIONS.length - 1 ? "" : "border-b border-border";
            return (
              <div className="contents" key={section}>
                <span className={`flex items-center px-4 py-2.5 text-sm font-semibold ${cell}`}>
                  {AGENT_SECTION_LABELS[section]}
                </span>
                <span className={`flex items-center justify-center px-4 py-2.5 ${cell}`}>
                  <Checkbox
                    aria-label={`Available in ${AGENT_SECTION_LABELS[section]}`}
                    checked={on}
                    className="min-h-0"
                    label={<span className="sr-only">Available</span>}
                    onCheckedChange={(checked) =>
                      set({
                        sections: toggle(form.sections, section, checked === true),
                        defaultFor: checked === true ? form.defaultFor : toggle(form.defaultFor, section, false),
                      })
                    }
                  />
                </span>
                <span className={`flex items-center justify-center px-4 py-2.5 ${cell}`}>
                  <Checkbox
                    aria-label={`Default in ${AGENT_SECTION_LABELS[section]}`}
                    checked={form.defaultFor.includes(section)}
                    className="min-h-0"
                    disabled={!on}
                    label={<span className="sr-only">Default</span>}
                    onCheckedChange={(checked) =>
                      set({ defaultFor: toggle(form.defaultFor, section, checked === true) })
                    }
                  />
                </span>
              </div>
            );
          })}
        </div>
        {errors.defaultFor || errors.sections ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {errors.defaultFor ?? errors.sections}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            The default agent runs when the person does not pick one.
          </p>
        )}
      </fieldset>
      <label className="flex items-center justify-between gap-3">
        <span className="grid">
          <span className="text-sm font-semibold">Enabled</span>
          <span className="text-xs text-muted-foreground">Disabled agents are hidden from every section.</span>
        </span>
        <Switch checked={form.enabled} disabled={disabled} onCheckedChange={(enabled) => set({ enabled })} />
      </label>
    </FormSection>
  );
}
