/**
 * Pre-run hooks. Pure, React-free, no heavy dependencies — see the note in
 * `../compress-pdf/hooks.ts` for why they may not live beside `run`.
 */

import type { ToolPagesInspected } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
  readonly degrees: string;
  readonly rotateSelectedOnly: boolean;
};

/**
 * Replaces the `rotate-pdf-pages` arm of `applyPdfInspection`
 * (`MediaWorkbench.tsx:724-725`). It seeds the keyword rather than concrete
 * page numbers, so a user who has chosen odd or even keeps that intent.
 */
export const onPagesInspected: ToolPagesInspected<Settings> = () => ({
  pages: "all",
});
