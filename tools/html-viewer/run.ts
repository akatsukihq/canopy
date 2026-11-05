/**
 * The default path remains verbatim from the former `html-viewer` case in
 * `lib/devtools/format-json.ts`: the input is returned unchanged with an HTML
 * output kind, guarded only by the required-input check.
 *
 * CONTAINMENT — unchanged, and deliberately not widened. The source never
 * sanitised the markup; it relied on the renderer, which puts the value in
 * `<iframe sandbox="" srcDoc={…}>`. An empty `sandbox` attribute is the most
 * restrictive setting there is: no scripts, no forms, no popups, no
 * navigation, no same-origin access. The `render: "html"` branch of
 * `components/ResultView.tsx` uses exactly the same empty `sandbox=""` iframe
 * as the legacy `outputKind === "html"` branch in
 * `components/UtilityToolPrimitives.tsx`, so the containment is identical
 * before and after this migration.
 *
 * Adding a sanitiser here would be a behaviour change (it would silently
 * rewrite the user's markup, which is the one thing a viewer must not do);
 * removing the sandbox would be an XSS hole. Neither was done.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly showOutlines: boolean;
};

const OUTLINE_STYLE = "<style>*,*::before,*::after{outline:1px solid #2563eb!important}</style>";

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const html = requireUtilityInput(ctx.input.text, "HTML source");
  return {
    render: "html",
    html: ctx.settings.showOutlines ? html.replace(/^(\s*<!doctype[^>]*>)?/i, `$&${OUTLINE_STYLE}`) : html,
    downloadName: "preview.html",
  };
};

export default run;
