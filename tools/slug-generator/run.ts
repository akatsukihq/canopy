/**
 * Moved verbatim from the `slug-generator` case in
 * `lib/devtools/format-json.ts` (arm at line 2323). `words` — which does the
 * NFKD normalization, accent stripping, and camelCase split — is shared
 * (`lib/devtools/shared/text.ts`) and is imported rather than copied.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { words } from "../../lib/devtools/shared/text.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: ctx.input.text
    .split(/\r\n|\r|\n/)
    .map((line) =>
      words(line)
        // Shared links must produce the same slug regardless of the browser locale.
        .map((word) => word.toLowerCase())
        .join("-"),
    )
    .filter(Boolean)
    .join("\n"),
  downloadName: "slugs.txt",
});

export default run;
