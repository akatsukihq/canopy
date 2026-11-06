import { Button } from "@/components/ui/index.tsx";
import type { ReactNode } from "react";

/** Header actions for editor pages: optional leading actions (Delete), Discard, Save changes. */
export function SaveActions({
  children,
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  /** Shown before Discard, e.g. the editor's Delete button. */
  children?: ReactNode;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <Button disabled={!dirty || saving} onClick={onDiscard} size="sm" type="button" variant="ghost">
        Discard
      </Button>
      <Button disabled={!dirty} loading={saving} onClick={onSave} size="sm" type="button">
        Save changes
      </Button>
    </div>
  );
}
