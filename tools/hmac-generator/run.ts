/**
 * Moved verbatim from `hmacText` / `bytesToHex` / `getCrypto` in
 * `lib/devtools/format-json.ts`. The crypto is Web Crypto `subtle.sign`, the
 * digest is lowercase hex, and neither is reimplemented here.
 *
 * The secret arrives as `input.secondary`, not as a setting: settings are
 * persisted UI state, and a secret must not be. It is read once, passed to
 * `importKey`, and never placed in the result, a log line, or an error message.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly algo: string;
};

function getCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new ToolError(
      "crypto-unavailable",
      "Secure browser cryptography is unavailable.",
      "Open this tool over HTTPS in a modern browser.",
      {
        messageRef: { key: "execution.errors.crypto-unavailable" },
        recoveryMessage: { key: "execution.recovery.crypto-unavailable" },
      },
    );
  }
  return globalThis.crypto;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacText(value: string, key: string, algorithm: string): Promise<string> {
  if (!key) {
    throw new ToolError(
      "secret-required",
      "Secret key is required.",
      "Enter the shared secret used by the verifying system.",
      {
        messageRef: { key: "execution.errors.secret-required" },
        recoveryMessage: { key: "execution.recovery.secret-required" },
      },
    );
  }
  const hash = algorithm === "sha1" ? "SHA-1" : algorithm === "sha512" ? "SHA-512" : "SHA-256";
  const cryptoKey = await getCrypto().subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const signature = await getCrypto().subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const digest = await hmacText(ctx.input.text, ctx.input.secondary ?? "", ctx.settings.algo);
  ctx.signal.throwIfAborted();
  return { render: "text", text: digest, downloadName: "hmac-digest.txt" };
};

export default run;
