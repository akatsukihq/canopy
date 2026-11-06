"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@/components/ui/index.tsx";
import { useState } from "react";

/** Confirmation dialog for destructive deletes; `onConfirm` resolves to an error message or null on success. */
export function DeleteButton({
  label,
  name,
  description,
  disabled,
  onConfirm,
}: {
  label: string;
  name: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const message = await onConfirm();
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <AlertDialog onOpenChange={(next) => !busy && setOpen(next)} open={open}>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} size="sm" type="button" variant="danger-subtle">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} type="button">
            Cancel
          </AlertDialogCancel>
          <Button disabled={busy} loading={busy} onClick={confirm} type="button" variant="destructive">
            {busy ? "Deleting…" : label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
