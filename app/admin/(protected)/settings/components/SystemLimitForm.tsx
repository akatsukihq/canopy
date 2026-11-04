"use client";

import { Button, Caption, Input, toast } from "@/components/ui/index.tsx";
import { useActionState, useEffect, useState } from "react";
import { updateSystemLimitAction, type SystemLimitActionState } from "../actions";
import { MIB, type LimitUnit } from "../lib/limitUnits";

const IDLE: SystemLimitActionState = { status: "idle", message: "" };

/** Edits one database-backed limit; byte limits are entered in MiB. The row title labels the input via `id`. */
export function SystemLimitForm({
  canEdit,
  id,
  limitKey,
  unit,
  updatedAt,
  value,
}: {
  canEdit: boolean;
  id: string;
  limitKey: string;
  unit: LimitUnit;
  updatedAt: string;
  value: number;
}) {
  const [state, action, pending] = useActionState(updateSystemLimitAction, IDLE);
  const scale = unit === "bytes" ? MIB : 1;
  const [text, setText] = useState(String(value / scale));
  const errorId = `${id}-error`;
  const fieldError = state.status === "error" ? state.fieldError : undefined;

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    else if (state.status === "error" && !state.fieldError) toast.error(state.message);
  }, [state]);

  return (
    <form action={action} className="grid gap-1.5">
      <input name="key" type="hidden" value={limitKey} />
      <input name="scale" type="hidden" value={scale} />
      <input name="updatedAt" type="hidden" value={state.updatedAt ?? updatedAt} />
      <div className="flex items-center gap-2">
        <Input
          aria-describedby={fieldError ? errorId : undefined}
          aria-invalid={fieldError ? true : undefined}
          className="min-w-0 flex-1"
          disabled={!canEdit}
          id={id}
          inputMode="decimal"
          min={unit === "bytes" ? 0.01 : 1}
          name="value"
          onChange={(event) => setText(event.target.value)}
          required
          step={unit === "bytes" ? 0.01 : 1}
          type="number"
          value={text}
        />
        <Caption className="shrink-0 text-muted-foreground">
          {unit === "bytes" ? "MiB" : unit === "chars" ? "characters" : unit}
        </Caption>
        {canEdit ? (
          <Button disabled={Number(text) * scale === value} loading={pending} size="sm" type="submit" variant="outline">
            Save
          </Button>
        ) : null}
      </div>
      {fieldError ? (
        <Caption className="text-destructive" id={errorId} role="alert">
          {fieldError}
        </Caption>
      ) : null}
    </form>
  );
}
