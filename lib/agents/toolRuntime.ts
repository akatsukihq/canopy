/** Server-only execution of custom tools (HTTP and code) and their AI SDK tool definitions. */
import "server-only";
import { z } from "zod";
import type { AITool } from "../ai/types.ts";
import { readCodeExecutionConfig } from "../code-execution/config.ts";
import { getCodeLanguage } from "../code-execution/languages.ts";
import { executeCode } from "../code-execution/run.ts";
import { log } from "../observability/logger.ts";
import { ToolError } from "../tool-framework/run.ts";
import { assertPublicHttpsUrl, BlockedUrlError } from "./publicUrl.ts";
import { applyOutput, type OutputResult, type SchemaStatus, type TransformRunner } from "./toolOutput.ts";
import { isOmittedArg, resolveUrl, substitute, TemplateError, type TemplateScope } from "./toolTemplate.ts";
import { customToolName, isJson, type CodeToolConfig, type CustomTool, type HttpToolConfig } from "./toolTypes.ts";

/** A custom tool attached to an agent, with that agent's decrypted input values. Never send to the browser. */
export type CustomToolRuntime = { tool: CustomTool; inputs: Record<string, string> };

/** Every stage of one call, for the admin Test panel; `result` is what the model receives. */
export type ToolRunReport = {
  ok: boolean;
  result: unknown;
  durationMs: number;
  httpStatus: number | null;
  exitCode: number | null;
  raw: string | null;
  parsed?: unknown;
  schema: SchemaStatus | null;
};

const MAX_REDIRECTS = 3;
const NOT_CONFIGURED = { error: "Code execution is not configured." };

type Outcome = Omit<ToolRunReport, "durationMs">;
const failed = (error: Record<string, unknown>, extra: Partial<Outcome> = {}): Outcome => ({
  ok: false,
  result: error,
  httpStatus: null,
  exitCode: null,
  raw: null,
  schema: null,
  ...extra,
});

function fromOutput(output: OutputResult, base: Partial<Outcome>): Outcome {
  return output.ok
    ? {
        ok: true,
        result: output.value,
        httpStatus: null,
        exitCode: null,
        raw: null,
        ...base,
        parsed: output.parsed,
        schema: output.schema,
      }
    : failed(output.error, { ...base, parsed: output.parsed, schema: output.schema });
}

/** Applies defaults and checks required fields. Number inputs become numbers so exact placeholders stay typed. */
function resolveInputs(
  tool: CustomTool,
  values: Record<string, string>,
): { ok: true; inputs: TemplateScope["inputs"] } | { ok: false; error: Record<string, unknown> } {
  const inputs: TemplateScope["inputs"] = {};
  for (const field of tool.inputs) {
    const value = values[field.id] || field.defaultValue || "";
    if (!value) {
      if (field.required)
        return { ok: false, error: { error: `The "${field.label}" input is not set for this agent.` } };
      continue;
    }
    if (field.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number))
        return { ok: false, error: { error: `The "${field.label}" input is not a number.` } };
      inputs[field.id] = number;
    } else if (field.type === "json") {
      if (!isJson(value)) return { ok: false, error: { error: `The "${field.label}" input is not valid JSON.` } };
      inputs[field.id] = JSON.parse(value);
    } else inputs[field.id] = value;
  }
  return { ok: true, inputs };
}

const codeLanguage = (config: CodeToolConfig) => getCodeLanguage(`${config.language}-compiler`);

type CodeRun =
  | { ok: true; stdout: string; exitCode: number | null }
  | { ok: false; error: Record<string, unknown>; exitCode: number | null };

/** Runs code on Piston through the shared gate and limits. Fails closed when execution is not configured. */
async function runCode(config: CodeToolConfig, stdin: string, signal: AbortSignal): Promise<CodeRun> {
  const language = codeLanguage(config);
  if (!language) return { ok: false, error: { error: "This code language is not available." }, exitCode: null };
  if (!readCodeExecutionConfig()) return { ok: false, error: NOT_CONFIGURED, exitCode: null };
  let result;
  try {
    result = await executeCode(language, config.source, stdin, signal);
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: { error: error.message }, exitCode: null };
    throw error;
  }
  const stderr = [result.compileOutput, result.stderr].filter(Boolean).join("\n");
  switch (result.status) {
    case "ok":
      return { ok: true, stdout: result.stdout, exitCode: result.exitCode };
    case "compile-error":
      return { ok: false, error: { error: "The code did not compile.", stderr }, exitCode: result.exitCode };
    case "runtime-error":
      return {
        ok: false,
        error: { error: `The code exited with code ${result.exitCode ?? "unknown"}.`, stderr },
        exitCode: result.exitCode,
      };
    case "time-limit":
      return {
        ok: false,
        error: { error: `The code ran longer than ${result.limitSeconds} seconds.`, stderr },
        exitCode: result.exitCode,
      };
    case "unavailable":
      return {
        ok: false,
        error:
          result.reason === "not-configured" ? NOT_CONFIGURED : { error: "Code execution is unavailable right now." },
        exitCode: null,
      };
    case "busy":
      return { ok: false, error: { error: "Code execution is busy. Try again shortly." }, exitCode: null };
    default:
      return {
        ok: false,
        error: { error: "The code was stopped before it finished.", stderr },
        exitCode: result.exitCode,
      };
  }
}

const transformWith =
  (signal: AbortSignal): TransformRunner =>
  async (config, stdin) => {
    const ran = await runCode(config, stdin, signal);
    return ran.ok ? { ok: true, stdout: ran.stdout } : { ok: false, error: ran.error };
  };

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

/** Fetches with manual redirects: every hop is SSRF-checked, and headers never follow to another origin. */
async function send(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string },
  signal: AbortSignal,
) {
  let current = url;
  let { method, headers, body } = init;
  for (let hop = 0; ; hop++) {
    await assertPublicHttpsUrl(current);
    // ponytail: check-then-fetch leaves a resolver race; pin the vetted IP with an undici dispatcher if it matters.
    const response = await fetch(current, { method, headers, body, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new TemplateError(`The server redirected more than ${MAX_REDIRECTS} times.`);
    const next = new URL(location, current);
    if (next.origin !== current.origin) headers = {};
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    current = next;
  }
}

async function runHttp(
  tool: CustomTool,
  http: HttpToolConfig,
  scope: TemplateScope,
  signal: AbortSignal,
): Promise<Outcome> {
  let url: URL;
  let headers: Record<string, string>;
  let body: string | undefined;
  try {
    url = resolveUrl(http.url, http.query, scope);
    headers = Object.fromEntries(
      Object.entries(http.headers).map(([name, value]) => {
        const resolved = substitute(value, scope);
        return [name, typeof resolved === "string" ? resolved : JSON.stringify(resolved)];
      }),
    );
    if (http.method !== "GET" && http.body !== null && !isOmittedArg(http.body, scope)) {
      body = JSON.stringify(substitute(http.body, scope));
      if (!hasHeader(headers, "content-type")) headers["content-type"] = "application/json";
    }
  } catch (error) {
    if (error instanceof TemplateError) return failed({ error: error.message });
    throw error;
  }
  const timeout = AbortSignal.timeout(http.timeoutMs);
  let response: Response;
  let raw: string;
  try {
    response = await send(url, { method: http.method, headers, body }, AbortSignal.any([signal, timeout]));
    raw = await response.text();
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.aborted) return failed({ error: `The request timed out after ${http.timeoutMs / 1000} seconds.` });
    if (error instanceof BlockedUrlError) return failed({ error: `The address is blocked. ${error.message}` });
    if (error instanceof TemplateError) return failed({ error: error.message });
    return failed({ error: "The server could not be reached." });
  }
  const base = { httpStatus: response.status, raw };
  if (!response.ok) return failed({ error: { status: response.status, body: raw } }, base);
  const output = await applyOutput(tool.output, raw, {
    responsePath: http.responsePath,
    transformInput: { body: raw, status: response.status, headers: Object.fromEntries(response.headers) },
    transform: transformWith(signal),
  });
  return fromOutput(output, base);
}

async function runCodeTool(
  tool: CustomTool,
  code: CodeToolConfig,
  scope: TemplateScope,
  signal: AbortSignal,
): Promise<Outcome> {
  const ran = await runCode(code, JSON.stringify({ args: scope.args, inputs: scope.inputs }), signal);
  if (!ran.ok) return failed(ran.error, { exitCode: ran.exitCode });
  const output = await applyOutput(tool.output, ran.stdout, {
    responsePath: null,
    transformInput: { stdout: ran.stdout },
    transform: transformWith(signal),
  });
  return fromOutput(output, { exitCode: ran.exitCode, raw: ran.stdout });
}

/** Whether a code-backed tool (code kind or the code parser) can run here. */
export function needsCodeExecution(tool: Pick<CustomTool, "kind" | "output">): boolean {
  return tool.kind === "code" || tool.output.parser === "code";
}

export const codeExecutionConfigured = () => readCodeExecutionConfig() !== null;

/**
 * Runs one call: validates args, resolves inputs, executes and runs the output pipeline. Every expected
 * failure is a model-facing `{ error }` result; only an abort of `signal` rejects.
 */
export async function runCustomTool(
  tool: CustomTool,
  args: unknown,
  values: Record<string, string>,
  signal: AbortSignal,
  audit: { runId?: string; agentId?: string } = {},
): Promise<ToolRunReport> {
  const started = performance.now();
  let report: Outcome;
  const checked = z.fromJSONSchema(tool.argsSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(args ?? {});
  const inputs = resolveInputs(tool, values);
  if (!checked.success)
    report = failed({
      error: "Invalid arguments",
      issues: checked.error.issues
        .slice(0, 10)
        .map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  else if (!inputs.ok) report = failed(inputs.error);
  else {
    const scope: TemplateScope = { args: (checked.data ?? {}) as Record<string, unknown>, inputs: inputs.inputs };
    if (tool.kind === "http" && tool.http) report = await runHttp(tool, tool.http, scope, signal);
    else if (tool.kind === "code" && tool.code) report = await runCodeTool(tool, tool.code, scope, signal);
    else report = failed({ error: "This tool is not set up." });
  }
  const durationMs = Math.round(performance.now() - started);
  // Args, inputs and bodies are never logged.
  log(report.ok ? "info" : "warn", "ai_tool.call", {
    runId: audit.runId ?? null,
    agentId: audit.agentId ?? null,
    toolId: tool.id,
    kind: tool.kind,
    status: report.ok ? "ok" : "error",
    durationMs,
  });
  return { ...report, durationMs };
}

/** The agent's custom tools as AI SDK tools named `custom_<key>`. Disabled tools are left out. */
export function customAITools(
  list: readonly CustomToolRuntime[],
  context: {
    signal: AbortSignal;
    runId?: string;
    agentId?: string;
    reportToolFailure: (name: string, error: unknown) => void;
  },
): Record<string, AITool> {
  const tools: Record<string, AITool> = {};
  for (const { tool, inputs } of list) {
    if (!tool.enabled) continue;
    const name = customToolName(tool.key);
    tools[name] = {
      description: tool.description,
      inputSchema: z.fromJSONSchema(tool.argsSchema as Parameters<typeof z.fromJSONSchema>[0]),
      ...(tool.output.schema
        ? { outputSchema: z.fromJSONSchema(tool.output.schema as Parameters<typeof z.fromJSONSchema>[0]) }
        : {}),
      ...(tool.requiresApproval ? { needsApproval: true } : {}),
      execute: async (input, { signal }) => {
        const run = AbortSignal.any([context.signal, ...(signal ? [signal] : [])]);
        try {
          return (await runCustomTool(tool, input, inputs, run, context)).result;
        } catch (error) {
          if (run.aborted) throw error;
          context.reportToolFailure(name, error);
          return { error: `The ${tool.name} tool failed unexpectedly. Continue without it.` };
        }
      },
    };
  }
  return tools;
}
