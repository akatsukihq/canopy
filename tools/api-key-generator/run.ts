/**
 * Moved verbatim from the `api-key-generator` case in
 * `lib/devtools/format-json.ts` (line 2910): the same prefix validation, the
 * same URL-safe 64-character alphabet, and the same `randomString` helper,
 * which draws from the Web Crypto API with rejection sampling so the
 * distribution over the alphabet stays uniform.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { randomString } from "../../lib/devtools/shared/crypto.ts";

type Settings = {
  readonly prefix: string;
  readonly environment: string;
  readonly length: number;
  readonly count: number;
  readonly characterSet: string;
  readonly avoidAmbiguous: boolean;
};

const ALPHABETS: Readonly<Record<string, string>> = {
  "url-safe": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const prefix = ctx.settings.prefix.trim();
  if (prefix && !/^[A-Za-z\d_-]{1,32}$/.test(prefix)) {
    throw new ToolError(
      "invalid-prefix",
      "Prefix may contain only letters, numbers, underscores, and hyphens.",
      "Use something short such as sk or pk_live, up to 32 characters.",
      {
        messageRef: { key: "execution.errors.invalid-prefix" },
        recoveryMessage: { key: "execution.recovery.invalid-prefix" },
      },
    );
  }
  const qualifiedPrefix =
    ctx.settings.environment === "none" ? prefix : [prefix, ctx.settings.environment].filter(Boolean).join("_");
  const selectedAlphabet = ALPHABETS[ctx.settings.characterSet];
  const alphabet = ctx.settings.avoidAmbiguous ? selectedAlphabet.replace(/[01IOl]/g, "") : selectedAlphabet;
  return {
    render: "list",
    items: Array.from({ length: ctx.settings.count }, () => {
      const body = randomString(ctx.settings.length, alphabet);
      return qualifiedPrefix ? `${qualifiedPrefix}_${body}` : body;
    }),
    downloadName: "api-keys.txt",
  };
};

export default run;
