/**
 * Entry point for every language tool's one-line `run.server.ts`:
 *
 *   runCode(
 *     definitionKey: string,                              // e.g. "python-compiler"; must be a key of CODE_LANGUAGES
 *     input: { text: string; secondary?: string },        // text = source code, secondary = stdin
 *     signal: AbortSignal,                                // request abort; propagates to the engine call
 *     versionId?: string,                                 // a `versions[].id` of the entry; omitted = default
 *   ): Promise<ToolResult>
 *
 *   // tools/python-compiler/run.server.ts
 *   import { runCode } from "@/lib/code-execution/run";
 *   export const run = ({ input, settings, signal }) => runCode("python-compiler", input, signal, settings.version);
 *
 * Resolves with a ToolResult for every engine outcome (ok, compile/runtime
 * error, killed, limits, unavailable, busy). Rejects with `ToolError` only for
 * an unknown key or version (`unknown-tool`) or invalid input (`source-*` / `stdin-*`),
 * and with the abort reason when `signal` aborts. Source, stdin and program
 * output are never logged.
 */

import { log } from "@/lib/observability/logger";
import { ToolError } from "@/lib/tool-framework/run";
import type { ToolResult } from "@/lib/tool-framework/result";
import { readCodeExecutionConfig } from "./config";
import { getCodeLanguage, type CodeLanguage } from "./languages";
import { emptyRun, normalizeExecution, type CodeRunResult } from "./normalize";
import { assertRuntimeAvailable, executeOnPiston, PistonUnavailableError, type UnavailableReason } from "./piston";
import { toToolResult } from "./result";
import { createSemaphore, type Semaphore } from "./semaphore";
import { validateCodeInput } from "./validate";

/** The compiler pages' only setting; `parseSettings` has already limited it to the declared choices. */
export type CodeSettings = { readonly version?: string };

const QUEUE_WAIT_MS = 5_000;
const BUSY_RETRY_SECONDS = 5;

let semaphore: { readonly max: number; readonly gate: Semaphore } | null = null;

function gateFor(max: number): Semaphore {
  if (!semaphore || semaphore.max !== max) semaphore = { max, gate: createSemaphore(max) };
  return semaphore.gate;
}

const unavailable = (language: CodeLanguage, reason: UnavailableReason): CodeRunResult => ({
  ...emptyRun(language),
  status: "unavailable",
  reason,
});

/**
 * Runs source with stdin through the shared gate and limits. Also used by custom code tools (lib/agents).
 * Throws ToolError for invalid input and the abort reason on abort; every engine outcome is a result.
 */
export async function executeCode(
  language: CodeLanguage,
  text: string,
  secondary: string | undefined,
  signal: AbortSignal,
): Promise<CodeRunResult> {
  const input = validateCodeInput(text, secondary);
  const config = readCodeExecutionConfig();
  if (!config) return unavailable(language, "not-configured");

  const release = await gateFor(config.maxConcurrent).acquire(signal, QUEUE_WAIT_MS);
  if (!release) return { ...emptyRun(language), status: "busy", retryAfterSeconds: BUSY_RETRY_SECONDS };
  try {
    await assertRuntimeAvailable(config, language, signal);
    const response = await executeOnPiston(config, language, input, signal);
    return normalizeExecution(language, response) ?? unavailable(language, "engine-error");
  } catch (error) {
    if (error instanceof PistonUnavailableError) return unavailable(language, error.reason);
    throw error;
  } finally {
    release();
  }
}

export async function runCode(
  definitionKey: string,
  input: { readonly text: string; readonly secondary?: string },
  signal: AbortSignal,
  versionId?: string,
): Promise<ToolResult> {
  const language = getCodeLanguage(definitionKey, versionId);
  if (!language) throw new ToolError("unknown-tool", "This tool is not available.");

  const startedAt = performance.now();
  let result: CodeRunResult;
  try {
    result = await executeCode(language, input.text, input.secondary, signal);
  } catch (error) {
    if (error instanceof ToolError || signal.aborted) throw error;
    // Never forward the original error: it could echo request content into logs or Sentry.
    log("error", "code_execution.failed", {
      tool: definitionKey,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    result = unavailable(language, "engine-error");
  }
  log(
    result.status === "unavailable" ? "warn" : "info",
    result.status === "unavailable" ? "code_execution.engine_unavailable" : "code_execution.completed",
    {
      tool: definitionKey,
      version: language.versionId,
      status: result.status,
      ...(result.status === "unavailable" && { reason: result.reason }),
      durationMs: Math.round(performance.now() - startedAt),
      sourceChars: input.text.length,
      stdinChars: input.secondary?.length ?? 0,
    },
  );
  return toToolResult(result);
}
