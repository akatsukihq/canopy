"use client";

import { Caption, Checkbox, ChipMultiSelect, Field, Input, StatusBadge } from "@/components/ui/index.tsx";
import type { ToolConnection } from "@/lib/agents/toolConnections.ts";
import type { CustomTool, ToolInputField } from "@/lib/agents/toolTypes.ts";
import type { AgentConnectionAttachment, AgentToolAttachment } from "@/lib/agents/types.ts";
import type { AgentForm } from "./agentForm";
import { FormSection, SectionLink, type SectionProps } from "./FormSection";
import { TemplateText } from "./TemplateText";

const toolErrorKey = (toolId: string, fieldId: string) => `customTools.${toolId}.${fieldId}`;
const connectionErrorKey = (connectionId: string, fieldId: string) => `connections.${connectionId}.${fieldId}`;
const CONNECTION = "conn:";

type Values = Record<string, string | null>;

function missing(
  fields: readonly ToolInputField[],
  values: Values,
  shared: readonly string[],
  key: (fieldId: string) => string,
) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.id];
    if (field.required && value !== null && !value && !field.defaultValue && !shared.includes(field.id))
      errors[key(field.id)] = `Enter ${field.label}.`;
  }
  return errors;
}

/** Required inputs still empty, and connections with no endpoint enabled. A saved or shared secret counts as set. */
export function customToolErrors(
  form: AgentForm,
  tools: readonly CustomTool[],
  connections: readonly ToolConnection[],
): Record<string, string> {
  let errors: Record<string, string> = {};
  for (const attached of form.customTools) {
    const tool = tools.find((entry) => entry.id === attached.toolId);
    errors = {
      ...errors,
      ...missing(tool?.inputs ?? [], attached.inputs, tool?.savedSecretValues ?? [], (id) =>
        toolErrorKey(attached.toolId, id),
      ),
    };
  }
  for (const attached of form.connections) {
    const connection = connections.find((entry) => entry.id === attached.connectionId);
    errors = {
      ...errors,
      ...missing(connection?.inputs ?? [], attached.inputs, connection?.savedSecretValues ?? [], (id) =>
        connectionErrorKey(attached.connectionId, id),
      ),
    };
    const enabled = form.customTools.some(
      (entry) => tools.find((tool) => tool.id === entry.toolId)?.connectionId === attached.connectionId,
    );
    if (!enabled) errors[`connections.${attached.connectionId}`] = "Enable at least one endpoint.";
  }
  return errors;
}

/** One agent's values for a list of input fields; saved secrets stay hidden and are kept when left blank. */
function InputsGrid({
  fields,
  values,
  savedSecrets,
  shared,
  idPrefix,
  errorKey,
  errors,
  disabled,
  onChange,
}: {
  fields: readonly ToolInputField[];
  values: Values;
  savedSecrets: readonly string[];
  /** Secret ids with a shared value on the tool or connection. */
  shared: readonly string[];
  idPrefix: string;
  errorKey: (fieldId: string) => string;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (fieldId: string, value: string | null) => void;
}) {
  if (!fields.length) return <Caption className="text-muted-foreground">No inputs.</Caption>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.id}`;
        const stored = field.type === "secret" && savedSecrets.includes(field.id);
        const usesShared = field.type === "secret" && shared.includes(field.id);
        return (
          <Field
            description={
              stored
                ? "Saved. Leave blank to keep it, or type a new value."
                : usesShared
                  ? "Uses the shared value unless you enter your own."
                  : (field.description ?? (field.defaultValue ? `Default: ${field.defaultValue}` : undefined))
            }
            error={errors[errorKey(field.id)]}
            htmlFor={id}
            key={field.id}
            label={field.label}
            required={field.required}
          >
            <Input
              autoComplete="off"
              className={field.type === "json" ? "font-mono" : undefined}
              disabled={disabled}
              inputMode={field.type === "number" ? "decimal" : undefined}
              onChange={(e) => onChange(field.id, stored && !e.target.value ? null : e.target.value)}
              placeholder={
                stored ? "Saved — leave blank to keep" : usesShared ? "Shared value" : (field.defaultValue ?? "")
              }
              type={field.type === "secret" ? "password" : field.type === "url" ? "url" : "text"}
              value={values[field.id] ?? ""}
            />
          </Field>
        );
      })}
    </div>
  );
}

function Badges({ enabled, approval }: { enabled: boolean; approval?: boolean }) {
  return (
    <>
      {enabled ? null : <StatusBadge variant="neutral">Disabled</StatusBadge>}
      {approval ? <StatusBadge variant="warning">Needs approval</StatusBadge> : null}
    </>
  );
}

export function CustomToolsSection({
  form,
  set,
  errors,
  disabled,
  tools,
  connections,
  saved,
  savedConnections,
}: SectionProps & {
  tools: readonly CustomTool[];
  connections: readonly ToolConnection[];
  saved: readonly AgentToolAttachment[];
  savedConnections: readonly AgentConnectionAttachment[];
}) {
  const standalone = tools.filter((tool) => !tool.connectionId);
  const endpointsOf = (connectionId: string) => tools.filter((tool) => tool.connectionId === connectionId);
  const connectionOf = (toolId: string) => tools.find((tool) => tool.id === toolId)?.connectionId ?? null;
  const attachedIds = new Set(form.customTools.map((entry) => entry.toolId));

  const select = (values: string[]) => {
    const connectionIds = values.filter((v) => v.startsWith(CONNECTION)).map((v) => v.slice(CONNECTION.length));
    const toolIds = values.filter((v) => !v.startsWith(CONNECTION));
    const kept = form.customTools.filter((entry) => {
      const owner = connectionOf(entry.toolId);
      return owner ? connectionIds.includes(owner) : toolIds.includes(entry.toolId);
    });
    const added = [
      ...toolIds.filter((id) => !attachedIds.has(id)),
      // A newly added connection starts with every endpoint enabled.
      ...connectionIds
        .filter((id) => !form.connections.some((entry) => entry.connectionId === id))
        .flatMap((id) => endpointsOf(id).map((tool) => tool.id)),
    ].map((toolId) => ({ toolId, inputs: {} }));
    set({
      customTools: [...kept, ...added],
      connections: connectionIds.map(
        (connectionId) =>
          form.connections.find((entry) => entry.connectionId === connectionId) ?? { connectionId, inputs: {} },
      ),
    });
  };
  const toggleEndpoints = (ids: string[], on: boolean) =>
    set({
      customTools: on
        ? [...form.customTools, ...ids.filter((id) => !attachedIds.has(id)).map((toolId) => ({ toolId, inputs: {} }))]
        : form.customTools.filter((entry) => !ids.includes(entry.toolId)),
    });
  const setToolInput = (toolId: string, fieldId: string, value: string | null) =>
    set({
      customTools: form.customTools.map((entry) =>
        entry.toolId === toolId ? { ...entry, inputs: { ...entry.inputs, [fieldId]: value } } : entry,
      ),
    });
  const setConnectionInput = (connectionId: string, fieldId: string, value: string | null) =>
    set({
      connections: form.connections.map((entry) =>
        entry.connectionId === connectionId ? { ...entry, inputs: { ...entry.inputs, [fieldId]: value } } : entry,
      ),
    });

  const options = [
    ...connections.map((connection) => ({
      value: `${CONNECTION}${connection.id}`,
      label: `${connection.name} (${endpointsOf(connection.id).length} endpoints)`,
      description: connection.description || connection.baseUrl,
    })),
    ...standalone.map((tool) => ({ value: tool.id, label: tool.name, description: tool.description })),
  ];
  const value = [
    ...form.connections.map((entry) => `${CONNECTION}${entry.connectionId}`),
    ...form.customTools.filter((entry) => !connectionOf(entry.toolId)).map((entry) => entry.toolId),
  ];

  return (
    <FormSection
      actions={
        <span className="flex gap-3">
          <SectionLink href="/admin/agents/tools">Tools</SectionLink>
          <SectionLink href="/admin/agents/connections">Connections</SectionLink>
        </span>
      }
      description="Your own HTTP and code tools and API connections. Enter this agent's values, such as an API key, on each card below. A secret with a shared value can be left blank."
      title="Custom tools"
    >
      <ChipMultiSelect
        aria-label="Custom tools and connections"
        disabled={disabled || options.length === 0}
        emptyText={options.length ? "No custom tools attached." : "No custom tools yet. Add one under Custom tools."}
        onChange={select}
        options={options}
        placeholder="Add a tool or connection…"
        value={value}
      />
      {errors.customTools ? (
        <p className="text-xs text-destructive" role="alert">
          {errors.customTools}
        </p>
      ) : null}

      {form.connections.map((attached) => {
        const connection = connections.find((entry) => entry.id === attached.connectionId);
        if (!connection) return null;
        const endpoints = endpointsOf(connection.id);
        const enabledCount = endpoints.filter((tool) => attachedIds.has(tool.id)).length;
        const endpointError = errors[`connections.${connection.id}`];
        return (
          <div className="grid gap-3 rounded-lg border border-border p-3" key={connection.id}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLink href={`/admin/agents/connections/${connection.id}`}>{connection.name}</SectionLink>
              <span className="truncate font-mono text-xs text-muted-foreground">
                <TemplateText value={connection.baseUrl} />
              </span>
              <Badges enabled={connection.enabled} />
            </div>
            <InputsGrid
              disabled={disabled}
              errorKey={(id) => connectionErrorKey(connection.id, id)}
              errors={errors}
              fields={connection.inputs}
              shared={connection.savedSecretValues}
              idPrefix={`agent-connection-${connection.id}`}
              onChange={(fieldId, next) => setConnectionInput(connection.id, fieldId, next)}
              savedSecrets={savedConnections.find((entry) => entry.connectionId === connection.id)?.savedSecrets ?? []}
              values={attached.inputs}
            />
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Endpoints · {enabledCount} of {endpoints.length} enabled
                </span>
                <Checkbox
                  checked={enabledCount === endpoints.length ? true : enabledCount ? "indeterminate" : false}
                  className="min-h-0"
                  disabled={disabled || !endpoints.length}
                  label="All"
                  onCheckedChange={(checked) =>
                    toggleEndpoints(
                      endpoints.map((tool) => tool.id),
                      checked === true,
                    )
                  }
                />
              </div>
              <div className="grid max-h-64 gap-y-0.5 overflow-y-auto">
                {endpoints.map((tool) => (
                  <Checkbox
                    checked={attachedIds.has(tool.id)}
                    disabled={disabled}
                    className="min-h-8"
                    key={tool.id}
                    label={
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                          {tool.http?.method}
                        </span>
                        <span className="min-w-0 truncate">{tool.name}</span>
                        <span className="flex shrink-0 gap-1">
                          <Badges approval={tool.requiresApproval} enabled={tool.enabled} />
                        </span>
                      </span>
                    }
                    onCheckedChange={(checked) => toggleEndpoints([tool.id], checked === true)}
                  />
                ))}
              </div>
              {endpointError ? (
                <p className="text-xs text-destructive" role="alert">
                  {endpointError}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}

      {form.customTools.map((attached) => {
        const tool = standalone.find((entry) => entry.id === attached.toolId);
        if (!tool) return null;
        return (
          <div className="grid gap-3 rounded-lg border border-border p-3" key={tool.id}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLink href={`/admin/agents/tools/${tool.id}`}>{tool.name}</SectionLink>
              <Badges approval={tool.requiresApproval} enabled={tool.enabled} />
            </div>
            <InputsGrid
              disabled={disabled}
              errorKey={(id) => toolErrorKey(tool.id, id)}
              errors={errors}
              fields={tool.inputs}
              shared={tool.savedSecretValues}
              idPrefix={`agent-tool-${tool.id}`}
              onChange={(fieldId, next) => setToolInput(tool.id, fieldId, next)}
              savedSecrets={saved.find((entry) => entry.toolId === tool.id)?.savedSecrets ?? []}
              values={attached.inputs}
            />
          </div>
        );
      })}
    </FormSection>
  );
}
