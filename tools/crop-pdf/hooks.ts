/**
 * Pre-run hooks. Pure, React-free, no heavy dependencies — see the note in
 * `../compress-pdf/hooks.ts` for why they may not live beside `run`.
 */

import type {
  ToolPagePreview,
  ToolPagesInspected,
  ToolSettingsChanged,
  ToolValidate,
} from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
};

/**
 * Replaces the crop-readiness half of `cropBoxReady` / `readinessMessage`
 * (`MediaWorkbench.tsx:970-999`).
 *
 * The negative-coordinate arm of that expression is gone by construction: both
 * fields declare `min: 0`, so `parseSettings` clamps before this is reached.
 * The per-page overflow arm is NOT expressible here — it needs page geometry,
 * which a settings-and-files predicate does not have. `run` still rejects it
 * with the same `invalid-crop` message, so correctness is unchanged; only the
 * pre-run hint is coarser.
 */
export const validate: ToolValidate<Settings> = (settings) => {
  if (
    [settings.cropX, settings.cropY, settings.cropWidth, settings.cropHeight].some((value) => !Number.isInteger(value))
  ) {
    return {
      message: "Enter whole-number points for Left, Bottom, Width, and Height.",
      messageRef: { key: "readiness.wholeNumbers" },
    };
  }
  return settings.cropWidth <= 0 || settings.cropHeight <= 0
    ? { message: "Width and Height must be greater than zero.", messageRef: { key: "readiness.positiveDimensions" } }
    : null;
};

/**
 * Replaces `applyPdfInspection`'s `crop-pdf` arms
 * (`MediaWorkbench.tsx:726-746`): reset the page selection, then seed the crop
 * box to the largest rectangle that fits every page.
 */
export const onPagesInspected: ToolPagesInspected<Settings> = (previews) => {
  if (previews.length === 0) return { pages: "all" };
  return {
    pages: "all",
    cropWidth: Math.floor(Math.min(...previews.map(({ pageWidth }) => pageWidth))),
    cropHeight: Math.floor(Math.min(...previews.map(({ pageHeight }) => pageHeight))),
  };
};

/**
 * `parseSettings` already resolved the expression to this union, so the
 * selection is filtered here rather than re-parsed. `"odd"`/`"even"` cannot be
 * enumerated without a page count, but the previews carry the real page
 * numbers, which is the same thing.
 */
function selectedPages(previews: readonly ToolPagePreview[], pages: PageSelection): readonly ToolPagePreview[] {
  if (pages === "all") return previews;
  if (pages === "odd") return previews.filter((p) => p.pageNumber % 2 === 1);
  if (pages === "even") return previews.filter((p) => p.pageNumber % 2 === 0);
  return previews.filter((p) => pages.includes(p.pageNumber));
}

/**
 * Replaces the crop arm of `changePdfPageSelection` (`MediaWorkbench.tsx
 * :761-789`): re-clamp the crop box against the pages that are actually
 * selected, so one box always fits them all.
 *
 * Two differences from the original. The `Math.max(0, …)` around the origin is
 * gone — `cropX`/`cropY` declare `min: 0`, so `parseSettings` clamps them
 * first. And the empty-selection arm no longer writes `pages: ""`: the page
 * selection is the user's edit, not this hook's to rewrite.
 */
export const onSettingsChanged: ToolSettingsChanged<Settings> = (settings, previews) => {
  const selected = selectedPages(previews, settings.pages);
  if (selected.length === 0) return {};
  const maxWidth = Math.min(...selected.map(({ pageWidth }) => Math.max(1, pageWidth - settings.cropX)));
  const maxHeight = Math.min(...selected.map(({ pageHeight }) => Math.max(1, pageHeight - settings.cropY)));
  return {
    cropWidth: Math.floor(Math.min(settings.cropWidth, maxWidth)),
    cropHeight: Math.floor(Math.min(settings.cropHeight, maxHeight)),
  };
};
