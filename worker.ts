import { Container } from "@cloudflare/containers";
import { runBlogPublishCron, type BlogCronEnv } from "./lib/blog/cron";
import { runAssistantMaintenanceCron, type AssistantCronEnv } from "./lib/assistant/cron.ts";

// Pass application settings explicitly; Worker bindings and deployment credentials
// must never become container environment variables.
const CONTAINER_ENV_KEYS = [
  "APP_URL",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "REDIS_URL",
  "CACHE_ENABLED",
  "BETTER_AUTH_SECRET",
  "AUTH_COOKIE_PREFIX",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "EMAIL_PROVIDER",
  "CLOUDFLARE_EMAIL_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "ACCOUNTS_EMAIL",
  "SUPPORT_EMAIL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_URL",
  "SCHEDULER_SECRET",
  "AI_ENABLED",
  "AI_PROVIDER",
  "AI_TITLE_MODEL",
  "OPENAI_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_TITLE_MODEL",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SETTINGS_ENCRYPTION_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_MODEL",
  "OPENAI_COMPATIBLE_TITLE_MODEL",
  "AHREFS_API_KEY",
  "GEMINI_API_KEY",
  "GA_MEASUREMENT_ID",
  "GA_ENABLE_IN_DEVELOPMENT",
  "VERCEL_ENV",
] as const;

type Env = BlogCronEnv &
  AssistantCronEnv &
  Partial<Record<(typeof CONTAINER_ENV_KEYS)[number], string>> & {
    CANOPY_CONTAINER: DurableObjectNamespace<CanopyContainer>;
  };

export class CanopyContainer extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "2m";
  enableInternet = true;

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    if (!env.APP_URL?.trim() || !env.DATABASE_URL?.trim() || !env.BETTER_AUTH_SECRET?.trim()) {
      throw new Error("Container runtime configuration is incomplete.");
    }
    this.envVars = { NODE_ENV: "production", HOSTNAME: "0.0.0.0", PORT: "3000" };
    for (const key of CONTAINER_ENV_KEYS) {
      const value = env[key];
      if (typeof value === "string") this.envVars[key] = value;
    }
  }
}

export default {
  async scheduled(controller: { cron: string }, env: Env) {
    switch (controller.cron) {
      case "*/30 * * * *": {
        const publishing = await runBlogPublishCron(env);
        if (publishing.failed) console.warn("Blog scheduled publishing has failed posts", publishing);
        else console.info("Blog scheduled publishing completed", publishing);
        break;
      }
      case "0 0,12 * * *": {
        const maintenance = await runAssistantMaintenanceCron(env);
        if (maintenance.failed) console.warn("Assistant maintenance needs retry", maintenance);
        else console.info("Assistant maintenance completed", maintenance);
        break;
      }
    }
  },
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // Preserve public/admin routing and Server Action origin checks across the
    // HTTP container hop, without trusting caller-provided proxy headers.
    headers.set("host", url.host);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
    headers.set("x-forwarded-port", url.port || (url.protocol === "https:" ? "443" : "80"));
    headers.delete("forwarded");
    headers.delete("cf-container-target-port");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
      headers.set("x-real-ip", clientIp);
    }
    try {
      // One shared instance keeps Node's catalog cache coherent for public/admin
      // requests. Return the response directly to preserve streams and cookies.
      return await env.CANOPY_CONTAINER.getByName("canopy").fetch(
        new Request(request, { headers, redirect: "manual" }),
      );
    } catch {
      console.error("Canopy container request failed.");
      return new Response("The application is temporarily unavailable. Please try again shortly.", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
