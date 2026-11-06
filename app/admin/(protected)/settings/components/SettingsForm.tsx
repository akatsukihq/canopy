"use client";

import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import {
  Button,
  Caption,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Switch,
  toast,
} from "@/components/ui/index.tsx";
import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { listModelsAction, saveSettingsAction, type SettingsActionState } from "../actions";
import type { GroupTest } from "../lib/sections";
import { ProviderActions, providerHint, type ProviderState } from "./ProviderActions";
import { SettingRow, SettingsSection } from "./SettingRow";

export type SettingField = {
  key: string;
  /** `limit` rows live in `system_limits`; `runtime` rows are overrides in `platform_settings`. */
  store: "limit" | "runtime";
  /** `secret` values never reach the browser: `value` is "" and typing replaces the saved one. */
  kind: "boolean" | "choice" | "number" | "text" | "secret" | "model";
  format?: "email" | "plain";
  /** Model fields: whose model list to suggest. */
  provider?: string;
  /** Secrets only: whether a value applies now (saved here or from the environment). */
  secretSet?: boolean;
  label: string;
  description: string;
  /** Current value as the input shows it (byte limits in MiB, booleans as "true"/"false"). */
  value: string;
  /** Stored value = shown value × scale. */
  scale?: number;
  unit?: string;
  options?: string[];
  updatedAt?: string;
  overridden?: boolean;
  /** What applies with no override, as shown to the admin. */
  defaultValue?: string;
  details?: ReactNode;
};

export type SettingGroup = {
  title: string;
  description?: string;
  fields: SettingField[];
  provider?: ProviderState;
  test?: GroupTest;
};

const IDLE: SettingsActionState = { status: "idle", message: "" };
const FORM_ID = "settings-form";

const shown = (field: SettingField, value: string) =>
  field.kind === "secret"
    ? value
      ? "from environment"
      : "not set"
    : field.kind === "boolean"
      ? value === "true"
        ? "On"
        : "Off"
      : value === ""
        ? "empty"
        : value;

/** A Settings page: every field edits a draft; one Save in the header writes all changes together. */
export function SettingsForm({
  canEdit,
  description,
  groups,
  title,
}: {
  canEdit: boolean;
  description: string;
  groups: SettingGroup[];
  title: string;
}) {
  const fields = groups.flatMap((group) => group.fields);
  const initial = Object.fromEntries(fields.map((field) => [field.key, field.value as string | null]));
  const [drafts, setDrafts] = useState(initial);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [state, action, pending] = useActionState(saveSettingsAction, IDLE);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<string[]>([]);

  // Fill model dropdowns for every AI provider whose key is already saved.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    const providers = groups.flatMap((group) => {
      return group.test === "ai" && group.provider && !group.provider.missing.length ? [group.provider.value] : [];
    });
    setLoadingModels(providers);
    for (const provider of providers) {
      void listModelsAction(provider, "").then((result) => {
        if (cancelled) return;
        if (result.models) setModels((current) => ({ ...current, [provider]: result.models ?? [] }));
        setLoadingModels((current) => current.filter((name) => name !== provider));
      });
    }
    return () => {
      cancelled = true;
    };
    // Once per mount; the page remounts the form after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = fields.filter((field) => drafts[field.key] !== field.value);
  const errors = { ...(state.status === "error" ? state.fieldErrors : undefined), ...localErrors };

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    else if (state.status === "error") toast.error(state.message);
  }, [state]);

  const set = (key: string, value: string | null) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    setLocalErrors(({ [key]: _removed, ...rest }) => rest);
  };

  const changes = {
    limits: dirty
      .filter((field) => field.store === "limit")
      .map((field) => ({
        key: field.key,
        value: Math.round(Number(drafts[field.key]) * (field.scale ?? 1)),
        updatedAt: field.updatedAt,
      })),
    runtime: dirty
      .filter((field) => field.store === "runtime")
      .map((field) => {
        const draft = drafts[field.key];
        return { key: field.key, value: draft === null ? null : field.kind === "boolean" ? draft === "true" : draft };
      }),
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const invalid = Object.fromEntries(
      dirty
        .filter((field) => field.kind === "number" && drafts[field.key] !== null)
        .filter((field) => (drafts[field.key] ?? "").trim() === "" || !Number.isFinite(Number(drafts[field.key])))
        .map((field) => [field.key, "Enter a number."]),
    );
    if (Object.keys(invalid).length) {
      event.preventDefault();
      setLocalErrors(invalid);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AdminPageHeader
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              {dirty.length ? (
                <Caption className="text-muted-foreground" role="status">
                  {dirty.length} unsaved {dirty.length === 1 ? "change" : "changes"}
                </Caption>
              ) : null}
              <Button
                disabled={!dirty.length || pending}
                onClick={() => {
                  setDrafts(initial);
                  setLocalErrors({});
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Discard
              </Button>
              <Button disabled={!dirty.length} form={FORM_ID} loading={pending} size="sm" type="submit">
                Save changes
              </Button>
            </div>
          ) : null
        }
        className="mb-0 shrink-0 sm:items-start"
        description={canEdit ? description : `${description} You can view these settings but not change them.`}
        title={title}
      />
      <form
        action={action}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
        id={FORM_ID}
        onSubmit={onSubmit}
      >
        <input name="changes" type="hidden" value={JSON.stringify(changes)} />
        {groups.map((group) => {
          const provider = group.provider;
          const hint = provider ? providerHint(provider, dirty.length > 0, group.test) : null;
          const apiKeyField = group.fields.find((field) => field.kind === "secret");
          const baseUrlField = group.fields.find((field) => field.key.endsWith(".baseUrl"));
          // A lone on/off setting needs no row: its switch lives in the card header.
          const toggle = group.fields.length === 1 && group.fields[0].kind === "boolean" ? group.fields[0] : null;
          if (toggle)
            return (
              <SettingsSection
                actions={
                  <Switch
                    aria-label={toggle.label}
                    checked={(drafts[toggle.key] ?? toggle.defaultValue) === "true"}
                    disabled={!canEdit}
                    onCheckedChange={(checked) => set(toggle.key, String(checked))}
                  />
                }
                description={toggle.description}
                key={group.title}
                title={toggle.label}
              />
            );
          return (
            <SettingsSection
              actions={
                provider ? (
                  <ProviderActions
                    canEdit={canEdit}
                    dirty={dirty.length > 0}
                    draftApiKey={apiKeyField ? (drafts[apiKeyField.key] ?? "") : undefined}
                    draftBaseUrl={baseUrlField ? (drafts[baseUrlField.key] ?? "") : undefined}
                    onModels={(list) => setModels((current) => ({ ...current, [provider.value]: list }))}
                    provider={provider}
                    test={group.test}
                  />
                ) : null
              }
              description={hint ? `${group.description ?? ""} ${hint}`.trim() : group.description}
              key={group.title}
              columns={group.fields.length % 3 === 0 ? 3 : 2}
              title={group.title}
            >
              {group.fields.map((field) => (
                <FieldRow
                  canEdit={canEdit}
                  models={field.provider ? models[field.provider] : undefined}
                  modelsLoading={field.provider ? loadingModels.includes(field.provider) : false}
                  changed={drafts[field.key] !== field.value}
                  draft={drafts[field.key] ?? null}
                  error={errors[field.key]}
                  field={field}
                  key={field.key}
                  onChange={(value) => set(field.key, value)}
                />
              ))}
            </SettingsSection>
          );
        })}
      </form>
    </div>
  );
}

function FieldRow({
  canEdit,
  changed,
  draft,
  error,
  field,
  models,
  modelsLoading,
  onChange,
}: {
  modelsLoading?: boolean;
  canEdit: boolean;
  /** Model ids loaded with this provider's key, offered as suggestions. */
  models?: string[];
  changed: boolean;
  draft: string | null;
  error?: string;
  field: SettingField;
  onChange: (value: string | null) => void;
}) {
  const editable = canEdit;
  const id = `setting-${field.key}`;
  const errorId = `${id}-error`;
  const resetting = draft === null;
  const value = draft ?? field.defaultValue ?? "";
  const invalid = {
    "aria-describedby": error ? errorId : field.description ? `${id}-description` : undefined,
    "aria-invalid": error ? true : undefined,
  };

  const control =
    field.kind === "boolean" ? (
      <Switch
        checked={value === "true"}
        disabled={!editable}
        id={id}
        onCheckedChange={(checked) => onChange(String(checked))}
      />
    ) : field.kind === "choice" ? (
      <Select disabled={!editable} onValueChange={onChange} value={value}>
        <SelectTrigger className="w-full" id={id} {...invalid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : field.kind === "secret" ? (
      <Input
        autoComplete="off"
        disabled={!editable}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          resetting
            ? "Removed on save"
            : field.overridden
              ? "Saved. Type to replace"
              : field.secretSet
                ? "From environment"
                : "Not set"
        }
        spellCheck={false}
        type="password"
        value={draft ?? ""}
        {...invalid}
      />
    ) : field.kind === "model" ? (
      <Select disabled={!editable} onValueChange={onChange} value={value}>
        <SelectTrigger className="w-full" id={id} {...invalid}>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          {/* The saved model stays selectable even if the key no longer lists it. */}
          {[...new Set([value, ...(models ?? [])].filter(Boolean))].map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <div
        aria-invalid={error ? true : undefined}
        className={
          field.unit
            ? "flex items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 aria-invalid:border-destructive"
            : undefined
        }
      >
        <Input
          className={
            field.unit
              ? "rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
              : undefined
          }
          disabled={!editable}
          id={id}
          inputMode={field.kind === "number" ? "decimal" : field.format === "plain" ? "text" : "email"}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.kind === "text" ? "Not set" : undefined}
          type={field.kind === "number" ? "number" : field.format === "plain" ? "text" : "email"}
          value={value}
          {...invalid}
        />
        {field.unit ? <Caption className="shrink-0 pr-3 text-muted-foreground">{field.unit}</Caption> : null}
      </div>
    );

  const status =
    field.store === "runtime" && (resetting || field.overridden) ? (
      <StatusBadge variant={resetting ? "warning" : "info"}>{resetting ? "Resets on save" : "Overridden"}</StatusBadge>
    ) : null;

  const undo = resetting
    ? "Undo reset"
    : changed
      ? "Undo"
      : field.store === "runtime" && field.overridden
        ? "Use default"
        : null;

  return (
    <SettingRow
      actions={
        editable && undo ? (
          <Button
            className="h-6 px-2 text-xs"
            onClick={() => onChange(resetting || changed ? field.value : null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {undo}
          </Button>
        ) : null
      }
      changed={changed}
      description={[
        field.description,
        field.kind === "model" && modelsLoading ? "Loading models…" : null,
        field.kind === "model" && !modelsLoading && !models?.length
          ? "Save a key, then Test & load models to list them."
          : null,
        field.store === "runtime" && field.overridden ? `Default: ${shown(field, field.defaultValue ?? "")}.` : null,
      ]
        .filter(Boolean)
        .join(" ")}
      details={field.details}
      error={error}
      errorId={errorId}
      id={id}
      inline={field.kind === "boolean"}
      label={field.label}
      status={status}
    >
      {control}
    </SettingRow>
  );
}
