import publicConfig from "./lib/config/public.ts";
import { captureRequestError } from "@sentry/nextjs";
import { log, logError } from "./lib/observability/logger.ts";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    log("info", "server.start", {
      node: process.version,
      environment: process.env.NODE_ENV,
      port: process.env.PORT,
      sentry: Boolean(publicConfig.sentryDsn),
    });
    // Monitor only observes: a plain "uncaughtException" listener would stop Node from exiting.
    process.on("uncaughtExceptionMonitor", (error, origin) => logError("process.crash", error, { origin }));
    // Runs orphaned by a restart would otherwise show "running" forever. Idempotent DB update, safe per replica.
    const sweep = () =>
      import("./lib/assistant/maintenance.ts")
        .then(({ failInterruptedRuns }) => failInterruptedRuns())
        .then((count) => count && log("info", "assistant.interrupted_runs_failed", { count }))
        .catch((error: unknown) => logError("assistant.interrupted_runs_sweep", error));
    void sweep();
    setInterval(sweep, 10 * 60_000).unref();
  }
  if (!publicConfig.sentryDsn) return;
  const { initializeSentry } = await import("./lib/observability/sentry");
  initializeSentry();
}

export const onRequestError: typeof captureRequestError = (error, request, context) => {
  logError("request.error", error, {
    method: request.method,
    // Path only: query strings can carry tokens and share fragments.
    path: request.path.split("?", 1)[0],
    route: context.routePath,
    routeType: context.routeType,
    digest: (error as { digest?: string }).digest,
  });
  return captureRequestError(error, request, context);
};
