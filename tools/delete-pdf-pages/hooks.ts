/**
 * Pre-run hooks. Pure, React-free, no heavy dependencies — see the note in
 * `../compress-pdf/hooks.ts` for why they may not live beside `run`.
 *
 * `parsePageSelection` comes from `lib/tool-framework/settings.ts`, which is a
 * pure parser with type-only imports. It is not under `media/`, so importing it
 * pulls in no vendor chunk.
 */

import type { ToolPagesInspected, ToolValidate } from "../../lib/tool-framework/run.ts";
import { parsePageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: string;
};

/**
 * Replaces the empty-selection half of the old flow: `buildJobOptions` threw
 * before the job started (`MediaWorkbench.tsx:830-841`) and the workbench
 * surfaced the message. The check is expressible without a page count, so it
 * runs here; anything needing the real count stays in `run`.
 */
export const validate: ToolValidate<Settings> = (settings) => {
  const value = settings.pages.trim().toLowerCase();
  // `parsePageSelection` cannot enumerate these without a page count, and
  // returns `[]` for them — which is intent, not emptiness.
  if (value === "odd" || value === "even") return null;
  const parsed = parsePageSelection(value);
  return parsed === "all" || parsed.length > 0
    ? null
    : { message: "Choose at least one page to delete.", messageRef: { key: "readiness.choosePages" } };
};

/**
 * Replaces the `delete-pdf-pages` arm of `applyPdfInspection`
 * (`MediaWorkbench.tsx:722-723`): a newly inspected document starts with
 * nothing selected for deletion.
 */
export const onPagesInspected: ToolPagesInspected<Settings> = () => ({
  pages: "",
});
