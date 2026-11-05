/**
 * Moved verbatim from the `nanoid-generator` case in
 * `lib/devtools/format-json.ts` (arm at line 2576), including the exact
 * alphabet. `randomString` and its unbiased `secureRandomInt` are shared
 * (`lib/devtools/shared/crypto.ts`) and are imported, not reimplemented.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { randomString } from "../../lib/devtools/shared/crypto.ts";

type Settings = {
  readonly count: number;
  readonly size: number;
};

const ALPHABET = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "list",
  items: Array.from({ length: ctx.settings.count }, () => randomString(ctx.settings.size, ALPHABET)),
  downloadName: "nanoids.txt",
});

export default run;
