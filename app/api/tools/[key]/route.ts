/**
 * The server execution host. It knows nothing about any individual tool: the
 * folder key arrives in the URL, and the dynamic import below is a bundler
 * context module over `tools/*` — the static prefix and suffix let the bundler
 * emit one chunk per folder. There is no map and no registry.
 *
 * A route handler rather than a server action on purpose: an action cannot be
 * resolved dynamically without pulling every tool's server module into the
 * client graph, which is exactly what `run.server.ts` exists to prevent.
 */

import { TOOL_SLUG_PATTERN } from "@/lib/tool-catalog/index.ts";
import { NextResponse } from "next/server";
import { captureException } from "@sentry/core";

import { CODE_LANGUAGES } from "@/lib/code-execution/languages";
import { checkRateLimit } from "@/lib/rateLimit";
import { loadRuntimeSettings } from "@/lib/config/runtimeSettings.ts";
import type { ToolResult } from "@/lib/tool-framework/result";
import { ToolError, type ToolRun } from "@/lib/tool-framework/run";
import { parseSettings } from "@/lib/tool-framework/settings";
import { loadSpecByDefinitionKey } from "@/lib/tool-framework/catalog";
import { errorMessage } from "@/utils/errorMessage";
import { log, logError } from "@/lib/observability/logger.ts";

/** Code execution is far costlier than other tools, so it gets its own, tighter bucket. */
const CODE_BODY_MAX_BYTES = 256 * 1024;

type ToolRequestBody = {
  readonly text?: unknown;
  readonly secondary?: unknown;
  readonly settings?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRun(module: unknown): ToolRun<never> {
  const run = isRecord(module) ? module.run : null;
  if (typeof run !== "function") {
    throw new ToolError("unknown-tool", "This tool is not available.");
  }
  return run as ToolRun<never>;
}

/** Return the error message without serializing its stack or other properties. */
function toFailure(error: unknown, fields: Record<string, unknown>): NextResponse {
  if (error instanceof ToolError) {
    log("warn", "api.tool.rejected", { ...fields, code: error.code });
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          recovery: error.recovery,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.code === "unknown-tool" ? 404 : 400 },
    );
  }
  captureException(error);
  logError("api.tool.failed", error, fields);
  return NextResponse.json(
    {
      error: {
        code: "processing-failed",
        message: errorMessage(error, "This tool could not finish. The input may be malformed or unsupported."),
      },
    },
    { status: 500 },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }): Promise<NextResponse> {
  const startedAt = performance.now();
  const fields: Record<string, unknown> = {};
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const { key } = await params;
    fields.tool = key;
    // `key` is untrusted and is about to become part of a module path.
    if (!TOOL_SLUG_PATTERN.test(key)) {
      throw new ToolError("unknown-tool", "This tool is not available.");
    }

    // This header is spoofable unless a trusted proxy overwrites it. Taking
    // only the first hop makes this a quota speed bump, not authorization.
    const clientKey = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown-client";
    // ponytail: no trusted proxy-set header is documented in this repo (no caddy/deploy config), so the
    // spoofable first hop stays; a spoofer can mint buckets, bounded by the engine semaphore. Switch to
    // the header the front proxy overwrites once task 6 documents it.
    const runtime = await loadRuntimeSettings();
    const rateLimit = Object.hasOwn(CODE_LANGUAGES, key)
      ? checkRateLimit(`code-exec:${clientKey}`, { limit: Number(runtime["traffic.codeRunsPerMinute"].value) })
      : checkRateLimit(`${key}:${clientKey}`, { limit: Number(runtime["traffic.toolRequestsPerMinute"].value) });
    if (!rateLimit.allowed) {
      log("warn", "api.tool.rate_limited", { tool: key, retryAfterSeconds: rateLimit.retryAfterSeconds });
      return NextResponse.json(
        {
          error: {
            code: "rate-limited",
            message: "Too many requests. Please try again shortly.",
            recovery: "Wait before running this tool again.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    // Code tools carry at most 64 KiB source + 64 KiB stdin; refuse anything bigger before buffering it.
    if (
      Object.hasOwn(CODE_LANGUAGES, key) &&
      Number(request.headers.get("content-length") ?? 0) > CODE_BODY_MAX_BYTES
    ) {
      throw new ToolError("invalid-request", "The request is too large. Reduce the code or input and try again.");
    }

    let body: ToolRequestBody;
    try {
      body = (await request.json()) as ToolRequestBody;
    } catch (error) {
      throw new ToolError("invalid-request", errorMessage(error, "Request body must be JSON."));
    }
    if (!isRecord(body)) {
      throw new ToolError("invalid-request", "Request body must be JSON.");
    }

    let runModule: unknown;
    try {
      runModule = await import(`../../../../tools/${key}/run.server`);
    } catch (error) {
      throw new ToolError("unknown-tool", errorMessage(error, "This tool is not available."));
    }
    const spec = await loadSpecByDefinitionKey(key);
    if (!spec) throw new ToolError("unknown-tool", "This tool is not available.");
    const run = readRun(runModule);

    const result: ToolResult = await run({
      input: {
        text: typeof body.text === "string" ? body.text : "",
        secondary: typeof body.secondary === "string" ? body.secondary : undefined,
        files: [],
      },
      settings: parseSettings(spec.settings, body.settings) as never,
      signal: request.signal,
      progress: () => {},
      writeArtifact: async () => {
        throw new ToolError("artifact-unsupported", "This server-hosted tool cannot create a browser-local artifact.");
      },
    });

    log("info", "api.tool.completed", { tool: key, durationMs: elapsed() });
    return NextResponse.json({ result });
  } catch (error) {
    // Code tools carry user source in their request; never let an error that might echo it reach Sentry or logs.
    const safe =
      typeof fields.tool === "string" && Object.hasOwn(CODE_LANGUAGES, fields.tool) && !(error instanceof ToolError)
        ? new Error("Code execution failed.")
        : error;
    return toFailure(safe, { ...fields, durationMs: elapsed() });
  }
}
