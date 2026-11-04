/**
 * Generate equivalent HTTP Basic Auth representations locally. Credentials
 * enter snippets only after Base64 encoding, never as raw shell or JS syntax.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { encodeBase64 } from "../../lib/devtools/shared/encoding.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";

type Settings = {
  readonly format: string;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const username = ctx.input.text;
  const password = ctx.input.secondary ?? "";
  if (username.includes(":")) {
    throw new ToolError("invalid-username", "Username cannot contain a colon (:).", "Use a username without a colon.", {
      messageRef: { key: "execution.errors.invalid-username" },
      recoveryMessage: { key: "execution.recovery.invalid-username" },
    });
  }
  if (/[\u0000-\u001f\u007f]/.test(username) || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new ToolError(
      "invalid-credentials",
      "Username and password cannot contain control characters.",
      "Remove line breaks, tabs, and other control characters, then try again.",
      {
        messageRef: { key: "execution.errors.invalid-credentials" },
        recoveryMessage: { key: "execution.recovery.invalid-credentials" },
      },
    );
  }
  requireUtilityInput(username, "Username");
  const encoded = encodeBase64(`${username}:${password}`);
  const value = `Basic ${encoded}`;
  const header = `Authorization: ${value}`;
  switch (ctx.settings.format) {
    case "value":
      return { render: "text", language: "plaintext", text: value };
    case "base64":
      return { render: "text", language: "plaintext", text: encoded };
    case "curl":
      return { render: "text", language: "bash", text: `curl --header '${header}' 'https://example.com/api'` };
    case "fetch":
      return {
        render: "text",
        language: "javascript",
        text: `await fetch("https://example.com/api", {\n  headers: {\n    Authorization: ${JSON.stringify(value)},\n  },\n});`,
      };
    default:
      return { render: "text", language: "http", text: header };
  }
};

export default run;
