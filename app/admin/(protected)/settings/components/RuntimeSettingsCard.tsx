"use client";

import {
  Button,
  Caption,
  Card,
  Field,
  H2,
  P,
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

const IDLE: RuntimeSettingActionState = { status: "idle", message: "" };

function RuntimeSettingRow({ canEdit, setting }: { canEdit: boolean; setting: RuntimeSettingView }) {
  const [state, action, pending] = useActionState(updateRuntimeSettingAction, IDLE);
  const [draft, setDraft] = useState(setting.value);
  const id = `runtime-${setting.key}`;
  const overridden = setting.source === "admin";

  useEffect(() => setDraft(setting.value), [setting.value]);
  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    else if (state.status === "error" && !state.fieldError) toast.error(state.message);
  }, [state]);

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <P className="font-medium">{setting.label}</P>
          <StatusBadge variant={overridden ? "info" : "neutral"}>{overridden ? "Overridden" : "From env"}</StatusBadge>
        </div>
        <Caption className="block text-muted-foreground">{setting.description}</Caption>
        {overridden ? (
          <Caption className="block text-muted-foreground">Environment value: {String(setting.envValue)}</Caption>
        ) : null}
      </div>
      <form action={action} className="flex items-start gap-2">
        <input name="key" type="hidden" value={setting.key} />
        <input name="value" type="hidden" value={String(draft)} />
        <Field
          className="w-56"
          error={state.status === "error" ? state.fieldError : undefined}
          htmlFor={id}
          label={setting.label}
        >
          {setting.kind === "boolean" ? (
            <Switch checked={draft === true} disabled={!canEdit} onCheckedChange={setDraft} />
          ) : (
            <Select disabled={!canEdit} onValueChange={setDraft} value={String(draft)}>
              <SelectTrigger>
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
          )}
        </Field>
        {canEdit ? (
          <>
            <Button
              className="mt-6"
              disabled={draft === setting.value}
              loading={pending}
              size="sm"
              type="submit"
              variant="outline"
            >
              Save
            </Button>
            {overridden ? (
              <Button
                className="mt-6"
                disabled={pending}
                formNoValidate
                name="reset"
                size="sm"
                type="submit"
                value="true"
                variant="ghost"
              >
                Reset to env
              </Button>
            ) : null}
          </>
        ) : null}
      </form>
    </li>
  );
}

/** Admin overrides for the runtime-settings allowlist; env values stay the defaults. */
export function RuntimeSettingsCard({ canEdit, settings }: { canEdit: boolean; settings: RuntimeSettingView[] }) {
  return (
    <Card>
      <H2>Runtime settings</H2>
      <Caption className="block text-muted-foreground">
        Override selected environment settings without a redeploy. Reset returns a setting to its environment value.
      </Caption>
      <ul className="divide-y divide-border">
        {settings.map((setting) => (
          <RuntimeSettingRow canEdit={canEdit} key={setting.key} setting={setting} />
        ))}
      </ul>
    </Card>
  );
}
