"use client";

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
import type { RuntimeSettingView } from "@/lib/admin/runtimeSettings.ts";
import { useActionState, useEffect, useState } from "react";
import { updateRuntimeSettingAction, type RuntimeSettingActionState } from "../actions";
import { SettingRow } from "./SettingRow";

const IDLE: RuntimeSettingActionState = { status: "idle", message: "" };

const display = (value: RuntimeSettingView["value"]) =>
  value === true ? "On" : value === false ? "Off" : value === "" ? "empty" : String(value);

/** One overridable setting. Env (or the code default) applies until Admin saves a value. */
export function RuntimeSettingRow({ canEdit, setting }: { canEdit: boolean; setting: RuntimeSettingView }) {
  const [state, action, pending] = useActionState(updateRuntimeSettingAction, IDLE);
  const [draft, setDraft] = useState(String(setting.value));
  const id = `runtime-${setting.key}`;
  const errorId = `${id}-error`;
  const overridden = setting.source === "admin";
  const fieldError = state.status === "error" ? state.fieldError : undefined;

  useEffect(() => setDraft(String(setting.value)), [setting.value]);
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    else if (state.status === "error" && !state.fieldError) toast.error(state.message);
  }, [state]);

  const errorProps = {
    "aria-describedby": fieldError ? errorId : undefined,
    "aria-invalid": fieldError ? true : undefined,
  };
  const control =
    setting.kind === "boolean" ? (
      <Switch
        checked={draft === "true"}
        disabled={!canEdit}
        id={id}
        onCheckedChange={(checked) => setDraft(String(checked))}
      />
    ) : setting.kind === "choice" ? (
      <Select disabled={!canEdit} onValueChange={setDraft} value={draft}>
        <SelectTrigger className="w-full" id={id} {...errorProps}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Input
        disabled={!canEdit}
        id={id}
        inputMode={setting.kind === "number" ? "numeric" : "email"}
        onChange={(event) => setDraft(event.target.value)}
        type={setting.kind === "number" ? "number" : "email"}
        value={draft}
        {...errorProps}
      />
    );

  return (
    <SettingRow
      description={setting.description}
      details={
        overridden ? (
          <Caption className="mt-1 block text-muted-foreground">
            Default from environment: {display(setting.envValue)}
          </Caption>
        ) : null
      }
      id={id}
      label={setting.label}
      status={
        <StatusBadge variant={overridden ? "info" : "neutral"}>{overridden ? "Overridden" : "Default"}</StatusBadge>
      }
    >
      <form action={action} className="grid gap-1.5">
        <input name="key" type="hidden" value={setting.key} />
        <input name="value" type="hidden" value={draft} />
        <div className="flex items-center gap-2">
          <div className={setting.kind === "boolean" ? "flex flex-1 items-center" : "min-w-0 flex-1"}>{control}</div>
          {setting.unit ? <Caption className="shrink-0 text-muted-foreground">{setting.unit}</Caption> : null}
          {canEdit ? (
            <Button
              disabled={draft === String(setting.value)}
              loading={pending}
              size="sm"
              type="submit"
              variant="outline"
            >
              Save
            </Button>
          ) : null}
        </div>
        {fieldError ? (
          <Caption className="text-destructive" id={errorId} role="alert">
            {fieldError}
          </Caption>
        ) : null}
        {canEdit && overridden ? (
          <Button
            className="justify-self-end"
            disabled={pending}
            formNoValidate
            name="reset"
            size="sm"
            type="submit"
            value="true"
            variant="ghost"
          >
            Reset to default
          </Button>
        ) : null}
      </form>
    </SettingRow>
  );
}
