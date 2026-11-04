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
import { saveSettingsAction, type SettingsActionState } from "../actions";
import { SettingRow, SettingsSection } from "./SettingRow";

export type SettingField = {
  key: string;
  /** `limit` rows live in `system_limits`; `runtime` rows are overrides in `platform_settings`. */
  store: "limit" | "runtime";
  kind: "boolean" | "choice" | "number" | "text";
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

export type SettingGroup = { title: string; description: string; fields: SettingField[] };

const IDLE: SettingsActionState = { status: "idle", message: "" };
const FORM_ID = "settings-form";

const shown = (field: SettingField, value: string) =>
  field.kind === "boolean" ? (value === "true" ? "On" : "Off") : value === "" ? "empty" : value;

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
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto">
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
        className="mb-0 shrink-0"
        description={canEdit ? description : `${description} You can view these settings but not change them.`}
        title={title}
      />
      <form action={action} className="grid gap-5" id={FORM_ID} onSubmit={onSubmit}>
        <input name="changes" type="hidden" value={JSON.stringify(changes)} />
        {groups.map((group) => (
          <SettingsSection description={group.description} key={group.title} title={group.title}>
            {group.fields.map((field) => (
              <FieldRow
                canEdit={canEdit}
                draft={drafts[field.key] ?? null}
                error={errors[field.key]}
                field={field}
                key={field.key}
                onChange={(value) => set(field.key, value)}
              />
            ))}
          </SettingsSection>
        ))}
      </form>
    </div>
  );
}

function FieldRow({
  canEdit,
  draft,
  error,
  field,
  onChange,
}: {
  canEdit: boolean;
  draft: string | null;
  error?: string;
  field: SettingField;
  onChange: (value: string | null) => void;
}) {
  const id = `setting-${field.key}`;
  const errorId = `${id}-error`;
  const resetting = draft === null;
  const value = draft ?? field.defaultValue ?? "";
  const invalid = { "aria-describedby": error ? errorId : undefined, "aria-invalid": error ? true : undefined };

  const control =
    field.kind === "boolean" ? (
      <Switch
        checked={value === "true"}
        disabled={!canEdit}
        id={id}
        onCheckedChange={(checked) => onChange(String(checked))}
      />
    ) : field.kind === "choice" ? (
      <Select disabled={!canEdit} onValueChange={onChange} value={value}>
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
    ) : (
      <Input
        className="min-w-0 flex-1"
        disabled={!canEdit}
        id={id}
        inputMode={field.kind === "number" ? "decimal" : "email"}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.kind === "text" ? "Not shown" : undefined}
        type={field.kind === "number" ? "number" : "email"}
        value={value}
        {...invalid}
      />
    );

  const status =
    field.store === "runtime" ? (
      <StatusBadge variant={resetting ? "warning" : field.overridden ? "info" : "neutral"}>
        {resetting ? "Resets on save" : field.overridden ? "Overridden" : "Default"}
      </StatusBadge>
    ) : null;

  return (
    <SettingRow
      description={field.description}
      details={
        <>
          {field.store === "runtime" && field.overridden ? (
            <Caption className="mt-1 block text-muted-foreground">
              Default: {shown(field, field.defaultValue ?? "")}
            </Caption>
          ) : null}
          {field.details}
        </>
      }
      id={id}
      label={field.label}
      status={status}
    >
      <div className="grid gap-1.5">
        <div className="flex min-h-9 items-center justify-end gap-2">
          {field.kind === "boolean" ? control : <div className="flex min-w-0 flex-1 items-center">{control}</div>}
          {field.unit ? <Caption className="shrink-0 text-muted-foreground">{field.unit}</Caption> : null}
        </div>
        {error ? (
          <Caption className="text-destructive" id={errorId} role="alert">
            {error}
          </Caption>
        ) : null}
        {canEdit && field.store === "runtime" && (field.overridden || resetting) ? (
          <Button
            className="justify-self-end"
            onClick={() => onChange(resetting ? field.value : null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {resetting ? "Undo reset" : "Use default"}
          </Button>
        ) : null}
      </div>
    </SettingRow>
  );
}
