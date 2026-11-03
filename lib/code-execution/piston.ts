import type { CodeExecutionConfig } from "./config";
import type { CodeInput } from "./validate";
import type { CodeLanguage } from "./languages";

const REQUEST_TIMEOUT_MS = 25_000;
const RUNTIME_TTL_MS = 60_000;

export type UnavailableReason = "not-configured" | "unreachable" | "runtime-missing" | "engine-error";

/** The engine could not be used; carries a reason, never request content. */
export class PistonUnavailableError extends Error {
  readonly reason: UnavailableReason;
  constructor(reason: UnavailableReason) {
    super(`Code execution engine unavailable: ${reason}`);
    this.name = "PistonUnavailableError";
    this.reason = reason;
  }
}

type RuntimeCache = { readonly fetchedAt: number; readonly runtimes: ReadonlySet<string> };
const runtimeCaches = new Map<string, RuntimeCache>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pistonFetch(
  config: CodeExecutionConfig,
  path: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.url}${path}`, {
      ...init,
      redirect: "error",
      headers: { ...init?.headers, authorization: `Bearer ${config.token}`, accept: "application/json" },
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PistonUnavailableError("unreachable");
  }
  // Piston answers HTTP 400 `{ message }` for requests it rejects; both are engine faults to the visitor.
  if (!response.ok) throw new PistonUnavailableError(response.status >= 500 ? "unreachable" : "engine-error");
  try {
    return await response.json();
  } catch {
    throw new PistonUnavailableError("engine-error");
  }
}

async function loadRuntimes(config: CodeExecutionConfig, signal: AbortSignal): Promise<ReadonlySet<string>> {
  const now = Date.now();
  const cached = runtimeCaches.get(config.url);
  if (cached && now - cached.fetchedAt < RUNTIME_TTL_MS) return cached.runtimes;

  const body = await pistonFetch(config, "/api/v2/runtimes", signal);
  if (!Array.isArray(body)) throw new PistonUnavailableError("engine-error");
  const runtimes = new Set<string>();
  for (const item of body) {
    if (!isRecord(item) || typeof item.language !== "string" || typeof item.version !== "string") continue;
    const names = [item.language, ...(Array.isArray(item.aliases) ? item.aliases : [])];
    for (const name of names) if (typeof name === "string") runtimes.add(`${name}@${item.version}`);
  }
  runtimeCaches.set(config.url, { fetchedAt: now, runtimes });
  return runtimes;
}

/** Throws `runtime-missing` when the pinned language/version is not installed on the engine. */
export async function assertRuntimeAvailable(
  config: CodeExecutionConfig,
  language: CodeLanguage,
  signal: AbortSignal,
): Promise<void> {
  const runtimes = await loadRuntimes(config, signal);
  if (!runtimes.has(`${language.language}@${language.version}`)) throw new PistonUnavailableError("runtime-missing");
}

/** The body is built only from the registry entry and validated input, never from client-supplied fields. */
export function buildExecuteBody(language: CodeLanguage, input: CodeInput): Record<string, unknown> {
  const limits = language.limits;
  return {
    language: language.language,
    version: language.version,
    files: [{ name: language.fileName, content: input.source }],
    stdin: input.stdin,
    ...(limits?.runTimeoutMs && { run_timeout: limits.runTimeoutMs }),
    ...(limits?.runCpuTimeMs && { run_cpu_time: limits.runCpuTimeMs }),
    ...(limits?.compileTimeoutMs && { compile_timeout: limits.compileTimeoutMs }),
    ...(limits?.compileCpuTimeMs && { compile_cpu_time: limits.compileCpuTimeMs }),
    ...(limits?.runMemoryBytes && { run_memory_limit: limits.runMemoryBytes }),
    ...(limits?.compileMemoryBytes && { compile_memory_limit: limits.compileMemoryBytes }),
  };
}

/** Returns the raw JSON; `normalizeExecution` validates its shape. */
export function executeOnPiston(
  config: CodeExecutionConfig,
  language: CodeLanguage,
  input: CodeInput,
  signal: AbortSignal,
): Promise<unknown> {
  return pistonFetch(config, "/api/v2/execute", signal, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildExecuteBody(language, input)),
  });
}
