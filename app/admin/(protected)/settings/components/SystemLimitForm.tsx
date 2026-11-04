"use client";

import { Button, Field, Input, toast } from "@/components/ui/index.tsx";
import { useActionState, useEffect, useState } from "react";
import { updateSystemLimitAction, type SystemLimitActionState } from "../actions";
import { MIB, type LimitUnit } from "../lib/limitUnits";

const IDLE: SystemLimitActionState = { status: "idle", message: "" };

/** Edits one database-backed limit; byte limits are entered in MiB. */
export function SystemLimitForm({
  canEdit,
  label,
  limitKey,
  unit,
  updatedAt,
  value,
}: {
  canEdit: boolean;
  label: string;
  limitKey: string;
  unit: LimitUnit;
  updatedAt: string;
  value: number;
}) {
  const [state, action, pending] = useActionState(updateSystemLimitAction, IDLE);
  const scale = unit === "bytes" ? MIB : 1;
  const [text, setText] = useState(String(value / scale));
  const id = `limit-${limitKey}`;

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    else if (state.status === "error" && !state.fieldError) toast.error(state.message);
  }, [state]);

  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <input name="key" type="hidden" value={limitKey} />
      <input name="scale" type="hidden" value={scale} />
      <input name="updatedAt" type="hidden" value={state.updatedAt ?? updatedAt} />
      <Field
        className="w-44"
        error={state.status === "error" ? state.fieldError : undefined}
        htmlFor={id}
        label={unit === "bytes" ? `${label} (MiB)` : `${label} (${unit === "chars" ? "characters" : unit})`}
      >
        <Input
          disabled={!canEdit}
          inputMode="decimal"
          min={unit === "bytes" ? 0.01 : 1}
          name="value"
          onChange={(event) => setText(event.target.value)}
          required
          step={unit === "bytes" ? 0.01 : 1}
          type="number"
          value={text}
        />
      </Field>
      {canEdit ? (
        <Button
          disabled={Number(text) * scale === value}
          loading={pending}
          size="sm"
          type="submit"
          variant="outline"
          className="mt-6"
        >
          Save
        </Button>
      ) : null}
    </form>
  );
}
