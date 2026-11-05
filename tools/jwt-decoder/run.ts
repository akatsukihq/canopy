/**
 * Moved verbatim from the `jwt-decoder` case in `lib/devtools/format-json.ts`
 * (arm at line 2430). `decodeJwt` is shared (`lib/devtools/shared/jwt.ts`).
 *
 * The token is a credential, so it arrives as `ctx.input.text` and never as a
 * setting — settings are persisted UI state. The old definition declared no
 * options at all, so there was nothing to move out of settings.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { decodeJwt } from "../../lib/devtools/shared/jwt.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const decoded = decodeJwt(ctx.input.text);
  const timestamps = Object.fromEntries(
    ["iat", "nbf", "exp"].flatMap((key) => {
      const claim = decoded.payload[key];
      return typeof claim === "number" ? [[key, new Date(claim * 1000).toISOString()] as const] : [];
    }),
  );
  return {
    render: "text",
    text: JSON.stringify(
      {
        header: decoded.header,
        payload: decoded.payload,
        timestamps,
        signature: decoded.signature,
      },
      null,
      2,
    ),
  };
};

export default run;
