import { randomString } from "../../lib/devtools/shared/crypto.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly length: number;
  readonly count: number;
  readonly charset: string;
};

const ALPHABETS: Readonly<Record<string, string>> = {
  alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  hex: "0123456789abcdef",
  all: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+",
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const alphabet = ALPHABETS[ctx.settings.charset];
  return {
    render: "list",
    items: Array.from({ length: ctx.settings.count }, () => randomString(ctx.settings.length, alphabet)),
    downloadName: "random-strings.txt",
  };
};

export default run;
