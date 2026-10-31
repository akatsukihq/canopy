/**
 * The server execution host. It knows nothing about any individual tool: the
 * folder key arrives in the URL, and the two dynamic imports below are bundler
 * context modules over `tools/*` — the static prefix and suffix let the bundler
 * emit one chunk per folder. There is no map and no registry.
 *
 * A route handler rather than a server action on purpose: an action cannot be
 * resolved dynamically without pulling every tool's server module into the
 * client graph, which is exactly what `run.server.ts` exists to prevent.
 */

import { TOOL_SLUG_PATTERN } from "@/lib/tool-catalog/index.ts";
import { NextResponse } from "next/server";
import { captureException } from "@sentry/core";

import { checkRateLimit } from "@/lib/rateLimit";
import type { ToolResult } from "@/lib/tool-framework/result";
import { ToolError, type ToolRun } from "@/lib/tool-framework/run";
import { parseSettings } from "@/lib/tool-framework/settings";
import type { ToolSpec } from "@/lib/tool-framework/spec";
import { errorMessage } from "@/utils/errorMessage";
import { log, logError } from "@/lib/observability/logger.ts";

type ToolRequestBody = {
  readonly text?: unknown;
  readonly secondary?: unknown;
  readonly settings?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSpec(module: unknown): ToolSpec {
  const spec = isRecord(module) ? module.default : null;
  if (!isRecord(spec) || !isRecord(spec.settings)) {
    throw new ToolError("unknown-tool", "This tool is not available.");
  }
  return spec as unknown as ToolSpec;
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
    const rateLimit = checkRateLimit(`${key}:${clientKey}`);
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

    let body: ToolRequestBody;
    try {
      body = (await request.json()) as ToolRequestBody;
    } catch (error) {
      throw new ToolError("invalid-request", errorMessage(error, "Request body must be JSON."));
    }
    if (!isRecord(body)) {
      throw new ToolError("invalid-request", "Request body must be JSON.");
    }

    let modules: readonly [unknown, unknown];
    try {
      modules = await Promise.all([
        import(`../../../../tools/${key}/definition`),
        import(`../../../../tools/${key}/run.server`),
      ]);
    } catch (error) {
      throw new ToolError("unknown-tool", errorMessage(error, "This tool is not available."));
    }

    const spec = readSpec(modules[0]);
    const run = readRun(modules[1]);

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
    return toFailure(error, { ...fields, durationMs: elapsed() });
  }
}
