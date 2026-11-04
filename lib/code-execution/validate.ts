import { ToolError } from "@/lib/tool-framework/run";

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_STDIN_BYTES = 64 * 1024;

export type CodeInput = { readonly source: string; readonly stdin: string };

const encoder = new TextEncoder();

function checkField(field: "source" | "stdin", value: string, maxBytes: number): void {
  const reject = (kind: string, message: string, recovery: string) =>
    new ToolError(`${field}-${kind}`, message, recovery, {
      messageRef: { key: `codeRun.${field}.${kind}`, values: { max: `${maxBytes / 1024} KiB` } },
    });
  const label = field === "source" ? "Source code" : "Input";
  // A lone surrogate cannot be encoded as UTF-8, so it would reach the engine as U+FFFD.
  if (!value.isWellFormed()) {
    throw reject("encoding", `${label} is not valid UTF-8 text.`, "Remove the unsupported characters and try again.");
  }
  if (value.includes("\0")) {
    throw reject("nul", `${label} contains a NUL character.`, "Remove the NUL (\\0) characters and try again.");
  }
  if (encoder.encode(value).byteLength > maxBytes) {
    throw reject(
      "too-large",
      `${label} is larger than ${maxBytes / 1024} KiB.`,
      `Shorten it to ${maxBytes / 1024} KiB or less.`,
    );
  }
}

/** Throws a ToolError whose code names the offending field (`source-*` or `stdin-*`). */
export function validateCodeInput(text: string, secondary: string | undefined): CodeInput {
  if (text.trim() === "") {
    throw new ToolError("source-required", "Write some code to run.", "Enter a program and press Run.", {
      messageRef: { key: "codeRun.source.required" },
    });
  }
  checkField("source", text, MAX_SOURCE_BYTES);
  const stdin = secondary ?? "";
  checkField("stdin", stdin, MAX_STDIN_BYTES);
  return { source: text, stdin };
}
