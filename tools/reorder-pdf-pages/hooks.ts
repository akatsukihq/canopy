/**
 * Pre-run hooks. Pure, React-free, no heavy dependencies — see the note in
 * `../compress-pdf/hooks.ts` for why they may not live beside `run`.
 */

import type { ToolPagesInspected } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
};

/**
 * Replaces the `reorder-pdf-pages` arm of `applyPdfInspection`
 * (`MediaWorkbench.tsx:720-721`), which seeded the order from the previews.
 * This is the one page-manipulation tool that must seed concrete numbers: an
 * ordering cannot be expressed as `"all"`.
 */
export const onPagesInspected: ToolPagesInspected<Settings> = (previews) =>
  previews.length > 0 ? { pages: previews.map(({ pageNumber }) => pageNumber) } : {};
