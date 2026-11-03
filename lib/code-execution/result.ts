import type { ToolFact, ToolRender, ToolResult, ToolResultSection, ToolVerdict } from "@/lib/tool-framework/result";
import type { ToolMessage } from "@/lib/tool-runtime/types";
import type { CodeRunResult } from "./normalize";

/**
 * English bootstrap copy for code-run outcomes; each tool stores its own
 * editable messages. Plain object so a Node fs walk can import it unbundled.
 */
export const CODE_RUN_MESSAGES = {
  "codeRun.source.required": "Write some code to run.",
  "codeRun.source.encoding": "Source code is not valid UTF-8 text.",
  "codeRun.source.nul": "Source code contains a NUL character.",
  "codeRun.source.too-large": "Source code is larger than {max}.",
  "codeRun.stdin.encoding": "Input is not valid UTF-8 text.",
  "codeRun.stdin.nul": "Input contains a NUL character.",
  "codeRun.stdin.too-large": "Input is larger than {max}.",
  "codeRun.ok":
    "Your program ran successfully in {duration} and printed {lines, plural, =0 {nothing} one {# line} other {# lines}}.",
  "codeRun.okDetail": "It exited with code 0.",
  "codeRun.compileError": "Compilation failed.",
  "codeRun.compileErrorAt": "Compilation failed at line {line}: {message}",
  "codeRun.compileErrorDetail": "Fix the error in the compiler output below, then run again.",
  "codeRun.runtimeError": "Your program stopped with an error (exit code {code}).",
  "codeRun.runtimeErrorDetail": "Check the error output below for the cause.",
  "codeRun.killed": "Your program was stopped by the signal {signal}.",
  "codeRun.killedDetail":
    "{signal, select, SIGKILL {SIGKILL usually means the memory or process limit was reached.} SIGSEGV {SIGSEGV means the program touched memory it does not own, for example an invalid pointer or unbounded recursion.} SIGABRT {SIGABRT means the program aborted itself, often after a failed assertion or an unhandled error.} SIGFPE {SIGFPE means an illegal arithmetic operation, such as dividing an integer by zero.} SIGXCPU {SIGXCPU means the CPU time limit was reached.} SIGXFSZ {SIGXFSZ means the program tried to write a file larger than allowed.} other {The operating system ended the program with this signal.}}",
  "codeRun.timeLimitRun":
    "Stopped after {seconds} seconds of {kind, select, wall {total running time} other {CPU time}}.",
  "codeRun.timeLimitCompile":
    "Compilation was stopped after {seconds} seconds of {kind, select, wall {total running time} other {CPU time}}.",
  "codeRun.timeLimitDetail": "Look for an endless loop or work that can be made smaller, then run again.",
  "codeRun.outputLimit":
    "Your program printed more than the allowed amount of {stream, select, stderr {error output} other {output}}.",
  "codeRun.outputLimitDetail": "The output below is cut off. Print less, then run again.",
  "codeRun.unavailable": "Code execution is not available right now.",
  "codeRun.unavailableDetail":
    "{reason, select, notConfigured {Running code is switched off on this server.} runtimeMissing {This language version is not installed on the execution server.} other {The execution server did not respond.}} Your code is kept. Try again in a minute.",
  "codeRun.busy": "The execution server is busy.",
  "codeRun.busyDetail": "Your code is kept. Try again in {seconds} seconds.",
  "codeRun.fact.time": "Run time",
  "codeRun.fact.cpu": "CPU time",
  "codeRun.fact.memory": "Memory",
  "codeRun.fact.exit": "Exit code",
  "codeRun.fact.signal": "Signal",
  "codeRun.fact.language": "Language",
  "codeRun.section.stdout": "Standard output",
  "codeRun.section.stderr": "Error output",
  "codeRun.section.compiler": "Compiler output",
} as const;

type MessageKey = keyof typeof CODE_RUN_MESSAGES;

/** Whole milliseconds below a second, then seconds: "60 ms", "1.48 s". */
const duration = (ms: number | null): string => {
  const value = Math.round(ms ?? 0);
  return value < 1 ? "under 1 ms" : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
};
const memory = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const countLines = (value: string): number => (value === "" ? 0 : value.replace(/\n$/, "").split("\n").length);

function verdict(
  level: ToolVerdict["level"],
  label: string,
  labelMessage: ToolMessage,
  detail: string,
  detailMessage: ToolMessage,
): ToolVerdict {
  return { level, label, labelMessage, detail, detailMessage };
}

const SIGNAL_HINTS: Readonly<Record<string, string>> = {
  SIGKILL: "SIGKILL usually means the memory or process limit was reached.",
  SIGSEGV:
    "SIGSEGV means the program touched memory it does not own, for example an invalid pointer or unbounded recursion.",
  SIGABRT: "SIGABRT means the program aborted itself, often after a failed assertion or an unhandled error.",
  SIGFPE: "SIGFPE means an illegal arithmetic operation, such as dividing an integer by zero.",
  SIGXCPU: "SIGXCPU means the CPU time limit was reached.",
  SIGXFSZ: "SIGXFSZ means the program tried to write a file larger than allowed.",
};

const msg = (key: MessageKey, values?: Record<string, string | number>): ToolMessage => ({ key, values });

function describe(result: CodeRunResult): ToolVerdict {
  switch (result.status) {
    case "ok": {
      const lines = countLines(result.stdout);
      const printed = lines === 0 ? "nothing" : lines === 1 ? "1 line" : `${lines} lines`;
      return verdict(
        "ok",
        `Your program ran successfully in ${duration(result.wallTimeMs)} and printed ${printed}.`,
        msg("codeRun.ok", { duration: duration(result.wallTimeMs), lines }),
        "It exited with code 0.",
        msg("codeRun.okDetail"),
      );
    }
    case "compile-error": {
      const detail = "Fix the error in the compiler output below, then run again.";
      const where = result.location;
      if (where?.message) {
        return verdict(
          "error",
          `Compilation failed at line ${where.line}: ${where.message}`,
          msg("codeRun.compileErrorAt", { line: where.line, message: where.message }),
          detail,
          msg("codeRun.compileErrorDetail"),
        );
      }
      return verdict(
        "error",
        "Compilation failed.",
        msg("codeRun.compileError"),
        detail,
        msg("codeRun.compileErrorDetail"),
      );
    }
    case "runtime-error":
      return verdict(
        "error",
        `Your program stopped with an error (exit code ${result.exitCode ?? "unknown"}).`,
        msg("codeRun.runtimeError", { code: result.exitCode ?? "unknown" }),
        "Check the error output below for the cause.",
        msg("codeRun.runtimeErrorDetail"),
      );
    case "killed":
      return verdict(
        "error",
        `Your program was stopped by the signal ${result.signalName}.`,
        msg("codeRun.killed", { signal: result.signalName }),
        SIGNAL_HINTS[result.signalName] ?? "The operating system ended the program with this signal.",
        msg("codeRun.killedDetail", { signal: result.signalName }),
      );
    case "time-limit": {
      const what = result.kind === "wall" ? "total running time" : "CPU time";
      const compile = result.stage === "compile";
      return verdict(
        "error",
        `${compile ? "Compilation was stopped" : "Stopped"} after ${result.limitSeconds} seconds of ${what}.`,
        msg(compile ? "codeRun.timeLimitCompile" : "codeRun.timeLimitRun", {
          seconds: result.limitSeconds,
          kind: result.kind,
        }),
        "Look for an endless loop or work that can be made smaller, then run again.",
        msg("codeRun.timeLimitDetail"),
      );
    }
    case "output-limit":
      return verdict(
        "warn",
        `Your program printed more than the allowed amount of ${result.stream === "stderr" ? "error output" : "output"}.`,
        msg("codeRun.outputLimit", { stream: result.stream }),
        "The output below is cut off. Print less, then run again.",
        msg("codeRun.outputLimitDetail"),
      );
    case "unavailable": {
      const reason =
        result.reason === "not-configured"
          ? "Running code is switched off on this server."
          : result.reason === "runtime-missing"
            ? "This language version is not installed on the execution server."
            : "The execution server did not respond.";
      return verdict(
        "warn",
        "Code execution is not available right now.",
        msg("codeRun.unavailable"),
        `${reason} Your code is kept. Try again in a minute.`,
        msg("codeRun.unavailableDetail", {
          reason:
            result.reason === "not-configured"
              ? "notConfigured"
              : result.reason === "runtime-missing"
                ? "runtimeMissing"
                : "other",
        }),
      );
    }
    case "busy":
      return verdict(
        "warn",
        "The execution server is busy.",
        msg("codeRun.busy"),
        `Your code is kept. Try again in ${result.retryAfterSeconds} seconds.`,
        msg("codeRun.busyDetail", { seconds: result.retryAfterSeconds }),
      );
  }
}

function fact(label: string, key: MessageKey, value: string): ToolFact {
  return { label, labelMessage: msg(key), value };
}

function facts(result: CodeRunResult): readonly ToolFact[] {
  const ran = result.wallTimeMs !== null;
  return [
    fact("Language", "codeRun.fact.language", `${result.language} ${result.version}`),
    ...(ran ? [fact("Run time", "codeRun.fact.time", duration(result.wallTimeMs))] : []),
    ...(result.cpuTimeMs !== null ? [fact("CPU time", "codeRun.fact.cpu", duration(result.cpuTimeMs))] : []),
    ...(result.memoryBytes !== null ? [fact("Memory", "codeRun.fact.memory", memory(result.memoryBytes))] : []),
    ...(result.signal
      ? [fact("Signal", "codeRun.fact.signal", result.signal)]
      : result.exitCode !== null
        ? [
            fact(
              "Exit code",
              "codeRun.fact.exit",
              result.exitCode === 0 ? "0 (finished normally)" : `${result.exitCode} (stopped with an error)`,
            ),
          ]
        : []),
  ];
}

function section(title: string, key: MessageKey, body: string): readonly ToolResultSection[] {
  return body === "" ? [] : [{ title, titleMessage: msg(key), body: { render: "text", text: body } }];
}

/** Plain-text streams only: output is never interpreted as HTML. */
export function toToolResult(result: CodeRunResult): ToolResult {
  const primary = result.status === "compile-error" ? result.compileOutput : result.output;
  const verdict = describe(result);
  const body: ToolRender =
    primary === "" ? { render: "none" } : { render: "text", text: primary, truncated: result.truncated };
  return {
    ...body,
    verdict,
    // Success is shown in the status bar; only problems interrupt with a toast.
    notification: verdict.level === "ok" ? undefined : verdict,
    stats: facts(result),
    // The combined output above already shows a single stream; split views only help when streams differ.
    sections:
      [result.stdout, result.stderr, result.compileOutput].filter((stream) => stream !== "").length < 2
        ? []
        : [
            ...section("Standard output", "codeRun.section.stdout", result.stdout),
            ...section("Error output", "codeRun.section.stderr", result.stderr),
            ...(result.status === "compile-error"
              ? []
              : section("Compiler output", "codeRun.section.compiler", result.compileOutput)),
          ],
  };
}
