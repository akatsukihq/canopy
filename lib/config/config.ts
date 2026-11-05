import publicConfig from "./public.ts";

/** Server/build configuration. Browser code must use ./public.ts. */
// Read lazily: CLI entry points load dotenv after imports, and request runtimes
// can supply environment values after module initialization.
const config = {
  get environment() {
    return process.env.NODE_ENV;
  },
  get appUrl() {
    return publicConfig.appUrl;
  },
  get databaseUrl() {
    return process.env.DATABASE_URL;
  },
  get databasePoolMax() {
    const value = Number(process.env.DATABASE_POOL_MAX);
    return Number.isSafeInteger(value) && value > 0 ? value : 3;
  },
  get redisUrl() {
    return process.env.REDIS_URL;
  },
  get cacheEnabled() {
    const override = process.env.CACHE_ENABLED?.trim().toLowerCase();
    if (override === "true") return true;
    if (override === "false") return false;
    return process.env.NODE_ENV !== "development";
  },
  get ci() {
    return process.env.CI;
  },
  get auth() {
    return {
      secret: process.env.BETTER_AUTH_SECRET,
      cookiePrefix: process.env.AUTH_COOKIE_PREFIX?.trim() || "smarttools",
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  },
  get email() {
    return {
      provider: process.env.EMAIL_PROVIDER ?? "cloudflare",
      accountId: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
      accountsEmail: process.env.ACCOUNTS_EMAIL,
      supportEmail: process.env.SUPPORT_EMAIL,
    };
  },
  get cloudinary() {
    return {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      url: process.env.CLOUDINARY_URL,
    };
  },
  get schedulerSecret() {
    return process.env.SCHEDULER_SECRET;
  },
  get ai() {
    return {
      enabled: process.env.AI_ENABLED === "true",
      provider: process.env.AI_PROVIDER ?? "openai",
      titleModel: process.env.AI_TITLE_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-terra",
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      },
    };
  },
  get analytics() {
    return {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      GA_MEASUREMENT_ID: process.env.GA_MEASUREMENT_ID,
      GA_ENABLE_IN_DEVELOPMENT: process.env.GA_ENABLE_IN_DEVELOPMENT,
    };
  },
  get integrations() {
    return {
      ahrefsApiKey: process.env.AHREFS_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
    };
  },
  get sentry() {
    return {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    };
  },
  get playwright() {
    return {
      appUrl: process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3000",
      port: process.env.PLAYWRIGHT_PORT,
      reuseServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    };
  },
};

export default config;
