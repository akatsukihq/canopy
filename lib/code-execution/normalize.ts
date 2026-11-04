import { DEFAULT_CODE_LIMITS, type CodeLanguage } from "./languages";
import type { UnavailableReason } from "./piston";

/** Displayed streams are capped so a pathological response cannot bloat the page. */
const MAX_STREAM_CHARS = 64 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export type CodeLocation = {
  readonly line: number;
  readonly column: number | null;
  /** The compiler's own wording for the error, when it could be isolated. */
  readonly message: string | null;
};

export type CodeRunBase = {
  readonly language: string;
  readonly version: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly compileOutput: string;
  /** stdout and stderr in the order the engine reports them. */
  readonly output: string;
  readonly truncated: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly wallTimeMs: number | null;
  readonly cpuTimeMs: number | null;
  readonly memoryBytes: number | null;
};

export type TimeLimitKind = "cpu" | "wall";

export type CodeRunResult =
  | (CodeRunBase & { readonly status: "ok" })
  | (CodeRunBase & { readonly status: "compile-error"; readonly location: CodeLocation | null })
  | (CodeRunBase & { readonly status: "runtime-error" })
  | (CodeRunBase & { readonly status: "killed"; readonly signalName: string })
  | (CodeRunBase & {
      readonly status: "time-limit";
      readonly stage: "compile" | "run";
      readonly kind: TimeLimitKind;
      readonly limitSeconds: number;
    })
  | (CodeRunBase & { readonly status: "output-limit"; readonly stream: "stdout" | "stderr" })
  | (CodeRunBase & { readonly status: "unavailable"; readonly reason: UnavailableReason })
  | (CodeRunBase & { readonly status: "busy"; readonly retryAfterSeconds: number });

type Stage = {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly code: number | null;
  readonly signal: string | null;
  readonly status: string | null;
  readonly message: string;
  readonly cpuTimeMs: number | null;
  readonly wallTimeMs: number | null;
  readonly memoryBytes: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function readStage(value: unknown): Stage | null {
  if (!isRecord(value)) return null;
  const stdout = text(value.stdout);
  const stderr = text(value.stderr);
  return {
    stdout,
    stderr,
    output: typeof value.output === "string" ? value.output : stdout + stderr,
    code: num(value.code),
    signal: typeof value.signal === "string" && value.signal ? value.signal : null,
    status: typeof value.status === "string" && value.status ? value.status : null,
    message: text(value.message),
    cpuTimeMs: num(value.cpu_time),
    wallTimeMs: num(value.wall_time),
    memoryBytes: num(value.memory),
  };
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

function clean(value: string): { readonly value: string; readonly cut: boolean } {
  const stripped = stripAnsi(value);
  return stripped.length > MAX_STREAM_CHARS
    ? { value: stripped.slice(0, MAX_STREAM_CHARS), cut: true }
    : { value: stripped, cut: false };
}

const LOCATION_PATTERNS: readonly ((output: string) => CodeLocation | null)[] = [
  // rustc: "error[E0308]: mismatched types\n --> main.rs:4:5"
  (output) => {
    const match = /^error(?:\[\w+\])?: (.+)\n\s*--> [^\n:]+:(\d+):(\d+)/m.exec(output);
    return match && { line: Number(match[2]), column: Number(match[3]), message: match[1] };
  },
  // tsc and the C# compiler: "main.ts(4,5): error TS1005: ';' expected."
  (output) => {
    const match = /^[^\s(][^\n(]*\((\d+),(\d+)\): error [\w]+: (.+)$/m.exec(output);
    return match && { line: Number(match[1]), column: Number(match[2]), message: match[3] };
  },
  // gcc, clang, kotlinc (line:col) and javac (line only): "main.c:4:5: error: expected ';'"
  (output) => {
    const match = /^(?:\.\/)?[^\s:()]+:(\d+):(?:(\d+):)? (?:fatal )?error: (.+)$/m.exec(output);
    return match && { line: Number(match[1]), column: match[2] ? Number(match[2]) : null, message: match[3] };
  },
  // go: "./main.go:4:2: undefined: x"
  (output) => {
    const match = /^(?:\.\/)?[^\s:]+\.go:(\d+):(\d+): (.+)$/m.exec(output);
    return match && { line: Number(match[1]), column: Number(match[2]), message: match[3] };
  },
];

export function extractLocation(compilerOutput: string): CodeLocation | null {
  const output = stripAnsi(compilerOutput);
  for (const pattern of LOCATION_PATTERNS) {
    const found = pattern(output);
    if (found) return found;
  }
  return null;
}

function base(language: CodeLanguage, stage: Stage | null, compile: Stage | null): CodeRunBase {
  const stdout = clean(stage?.stdout ?? "");
  const stderr = clean(stage?.stderr ?? "");
  const output = clean(stage?.output ?? "");
  const compileOutput = clean(compile ? compile.output : "");
  return {
    language: language.language,
    version: language.version,
    stdout: stdout.value,
    stderr: stderr.value,
    compileOutput: compileOutput.value,
    output: output.value,
    truncated: stdout.cut || stderr.cut || output.cut || compileOutput.cut,
    exitCode: stage?.code ?? null,
    signal: stage?.signal ?? null,
    wallTimeMs: stage?.wallTimeMs ?? null,
    cpuTimeMs: stage?.cpuTimeMs ?? null,
    memoryBytes: stage?.memoryBytes ?? null,
  };
}

/** Result for outcomes decided before or instead of a run (engine down, busy). */
export function emptyRun(language: CodeLanguage): CodeRunBase {
  return base(language, null, null);
}

function timeLimit(stage: "compile" | "run", failed: Stage): { kind: TimeLimitKind; limitSeconds: number } {
  const wall = /wall/i.test(failed.message);
  const limitMs =
    stage === "run"
      ? wall
        ? DEFAULT_CODE_LIMITS.runTimeoutMs
        : DEFAULT_CODE_LIMITS.runCpuTimeMs
      : wall
        ? DEFAULT_CODE_LIMITS.compileTimeoutMs
        : DEFAULT_CODE_LIMITS.compileCpuTimeMs;
  return { kind: wall ? "wall" : "cpu", limitSeconds: limitMs / 1000 };
}

/** Returns null when the response is not a recognisable Piston execution; the caller treats that as `unavailable`. */
export function normalizeExecution(language: CodeLanguage, response: unknown): CodeRunResult | null {
  if (!isRecord(response)) return null;
  const run = readStage(response.run);
  if (!run) return null;
  const compile = readStage(response.compile);

  if (run.status === "XX" || compile?.status === "XX") {
    return { ...base(language, run, compile), status: "unavailable", reason: "engine-error" };
  }

  if (compile && (compile.status !== null || (compile.code !== null && compile.code !== 0))) {
    const common = base(language, compile, compile);
    if (compile.status === "TO")
      return { ...common, status: "time-limit", stage: "compile", ...timeLimit("compile", compile) };
    if (compile.status === "OL" || compile.status === "EL") {
      return {
        ...common,
        status: "output-limit",
        truncated: true,
        stream: compile.status === "OL" ? "stdout" : "stderr",
      };
    }
    return { ...common, status: "compile-error", location: extractLocation(compile.output) };
  }

  const common = base(language, run, compile);
  switch (run.status) {
    case "TO":
      return { ...common, status: "time-limit", stage: "run", ...timeLimit("run", run) };
    case "OL":
    case "EL":
      return { ...common, status: "output-limit", truncated: true, stream: run.status === "OL" ? "stdout" : "stderr" };
    case "SG":
      return { ...common, status: "killed", signalName: run.signal ?? "unknown" };
    case "RE":
      return { ...common, status: "runtime-error" };
  }
  if (run.signal) return { ...common, status: "killed", signalName: run.signal };
  if (run.code !== 0) return { ...common, status: "runtime-error" };
  return { ...common, status: "ok" };
}
