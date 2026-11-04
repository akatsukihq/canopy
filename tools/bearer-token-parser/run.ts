/**
 * Moved verbatim from the `bearer-token-parser` case in
 * `lib/devtools/format-json.ts`: the same case-insensitive `Bearer ` strip, the
 * same three-part test, and the same shared `decodeJwt`.
 *
 * The token is echoed in the result because that is the tool's output contract
 * — it is never written to a log, and no error message contains it.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { decodeJwt } from "../../lib/devtools/shared/jwt.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly inputFormat: string;
  readonly decodeJwtParts: boolean;
  readonly maskRawToken: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const input = requireUtilityInput(ctx.input.text, "Authorization header or token").trim();
  const inputFormat = ctx.settings.inputFormat ?? "auto";
  if (inputFormat === "header" && !/^Bearer\s+/i.test(input)) {
    throw new ToolError(
      "authorization-header-required",
      "Authorization header must start with Bearer.",
      "Paste the whole Authorization header or choose Raw token.",
      {
        messageRef: { key: "execution.errors.authorization-header-required" },
        recoveryMessage: { key: "execution.recovery.authorization-header-required" },
      },
    );
  }
  const token = inputFormat === "raw" ? input : input.replace(/^Bearer\s+/i, "");
  if (!token) {
    throw new ToolError(
      "token-required",
      "Bearer token is required.",
      "Paste the token itself, not just the Bearer prefix.",
      {
        messageRef: { key: "execution.errors.token-required" },
        recoveryMessage: { key: "execution.recovery.token-required" },
      },
    );
  }
  const displayedToken = ctx.settings.maskRawToken === true ? "••••••••" : token;
  if ((ctx.settings.decodeJwtParts ?? true) && token.split(".").length === 3) {
    const decoded = decodeJwt(token);
    const value = {
      token: displayedToken,
      header: decoded.header,
      payload: decoded.payload,
    };
    return {
      render: "json-tree",
      value,
      text: JSON.stringify(value, null, 2),
    };
  }
  return {
    render: "key-value",
    entries: [
      { label: "Token", labelMessage: { key: "execution.token" }, value: displayedToken },
      { label: "Length", labelMessage: { key: "execution.length" }, value: String(token.length) },
    ],
  };
};

export default run;
