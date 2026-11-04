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
  StatusBadge,
  toast,
} from "@/components/ui/index.tsx";
import { useState, useTransition } from "react";
import { activateProviderAction, listModelsAction, testEmailAction, type ProviderActionState } from "../actions";
import type { GroupProvider, GroupTest } from "../lib/sections";

export type ProviderState = GroupProvider & {
  label: string;
  active: boolean;
  /** Labels of required settings with no saved value. */
  missing: string[];
};

const report = (result: ProviderActionState) =>
  result.status === "success" ? toast.success(result.message) : toast.error(result.message);

/** Header actions for one provider: test it, and make it the active one after a confirm. */
export function ProviderActions({
  canEdit,
  dirty,
  draftApiKey,
  draftBaseUrl,
  onModels,
  provider,
  test,
}: {
  canEdit: boolean;
  /** Unsaved edits on the page; switching and email tests use saved settings only. */
  dirty: boolean;
  /** AI only: the unsaved key typed in this group, tried before the saved one. */
  draftApiKey?: string;
  /** OpenAI-compatible only: the unsaved base URL. */
  draftBaseUrl?: string;
  onModels: (models: string[]) => void;
  provider: ProviderState;
  test?: GroupTest;
}) {
  const [open, setOpen] = useState(false);
  const [testing, startTest] = useTransition();
  const [switching, startSwitch] = useTransition();

  const runTest = () =>
    startTest(async () => {
      const result =
        test === "ai"
          ? await listModelsAction(provider.value, draftApiKey ?? "", draftBaseUrl ?? "")
          : await testEmailAction(provider.value);
      if (result.models) onModels(result.models);
      report(result);
    });

  const activate = () =>
    startSwitch(async () => {
      const result = await activateProviderAction(provider.setting, provider.value);
      report(result);
      if (result.status === "success") setOpen(false);
    });

  const testLabel = test === "ai" ? "Test & load models" : "Send test email";

  return (
    <div className="flex shrink-0 items-center gap-2">
      {provider.active ? <StatusBadge variant="success">Active</StatusBadge> : null}
      {canEdit && test ? (
        <Button
          disabled={test === "email" && dirty}
          loading={testing}
          onClick={runTest}
          size="sm"
          type="button"
          variant="outline"
        >
          {testLabel}
        </Button>
      ) : null}
      {canEdit && !provider.active ? (
        <AlertDialog onOpenChange={(next) => !switching && setOpen(next)} open={open}>
          <AlertDialogTrigger asChild>
            <Button disabled={dirty || provider.missing.length > 0} size="sm" type="button">
              Make active
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch to {provider.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                Every request from now on uses {provider.label} with its saved settings. The current provider keeps its
                settings, so you can switch back at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={switching} type="button">
                Cancel
              </AlertDialogCancel>
              <Button loading={switching} onClick={activate} type="button">
                Switch to {provider.label}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

/** Why "Make active" or the email test is unavailable, shown inline under the group title. */
export function providerHint(provider: ProviderState, dirty: boolean, test?: GroupTest): string | null {
  if (provider.active) return null;
  if (provider.missing.length) return `To make it active, save: ${provider.missing.join(", ")}.`;
  if (dirty)
    return test === "email"
      ? "Save or discard your changes to test or switch."
      : "Save or discard your changes to switch.";
  return null;
}
