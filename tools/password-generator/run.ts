import { randomString } from "../../lib/devtools/shared/crypto.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly length: number;
  readonly count: number;
  readonly upper: boolean;
  readonly lower: boolean;
  readonly numbers: boolean;
  readonly symbols: boolean;
  readonly excludeAmbiguous: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const alphabet = [
    ctx.settings.upper ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
    ctx.settings.lower ? "abcdefghijklmnopqrstuvwxyz" : "",
    ctx.settings.numbers ? "0123456789" : "",
    ctx.settings.symbols ? "!@#$%^&*()-_=+[]{}" : "",
  ].join("");
  const usableAlphabet = ctx.settings.excludeAmbiguous ? alphabet.replace(/[0OIl]/g, "") : alphabet;
  return {
    render: "list",
    items: Array.from({ length: ctx.settings.count }, () => randomString(ctx.settings.length, usableAlphabet)),
    downloadName: "passwords.txt",
  };
};

export default run;
