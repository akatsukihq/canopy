import { test, expect, onTestFinished } from "vitest";
import config from "../lib/config/config.ts";
import publicConfig from "../lib/config/public.ts";

test("email provider defaults to Cloudflare and reads overrides lazily", () => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  process.env = {};
  expect(config.email.provider).toBe("cloudflare");
  process.env.EMAIL_PROVIDER = "custom";
  expect(config.email.provider).toBe("custom");
  process.env = { EMAIL_PROVIDER: "cloudflare" };
  expect(config.email.provider).toBe("cloudflare");
  delete process.env.EMAIL_PROVIDER;
  expect(config.email.provider).toBe("cloudflare");
});

test("database pool maximum defaults safely and reads valid environment overrides lazily", (t) => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  process.env = {};
  expect(config.databasePoolMax).toBe(3);

  for (const [value, expected] of [
    ["", 3],
    ["   ", 3],
    ["invalid", 3],
    ["5connections", 3],
    ["0", 3],
    ["-1", 3],
    ["1.5", 3],
    ["NaN", 3],
    ["Infinity", 3],
    ["9007199254740992", 3],
    ["1", 1],
    [" 5 ", 5],
    ["10", 10],
  ]) {
    process.env.DATABASE_POOL_MAX = value;
    expect(config.databasePoolMax, `DATABASE_POOL_MAX=${value}`).toBe(expected);
  }

  process.env = { DATABASE_POOL_MAX: "7" };
  expect(config.databasePoolMax).toBe(7);
  delete process.env.DATABASE_POOL_MAX;
  expect(config.databasePoolMax).toBe(3);
});

test("auth cookie prefix keeps the existing default and reads environment overrides lazily", (t) => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  process.env = {};
  expect(config.auth.cookiePrefix).toBe("smarttools");
  for (const [value, expected] of [
    ["", "smarttools"],
    ["   ", "smarttools"],
    ["canopy", "canopy"],
    [" canopy-test ", "canopy-test"],
  ]) {
    process.env.AUTH_COOKIE_PREFIX = value;
    expect(config.auth.cookiePrefix).toBe(expected);
  }
});

test("cache reads default off in development and support an explicit environment override", (t) => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  for (const [environment, override, expected] of [
    ["development", undefined, false],
    ["development", "", false],
    ["development", "true", true],
    ["development", "false", false],
    ["production", undefined, true],
    ["production", "false", false],
    ["production", "true", true],
    ["test", undefined, true],
    [undefined, undefined, true],
  ]) {
    process.env = {};
    if (environment !== undefined) process.env.NODE_ENV = environment;
    if (override !== undefined) process.env.CACHE_ENABLED = override;
    expect(config.cacheEnabled, `${environment}, CACHE_ENABLED=${override}`).toBe(expected);
  }
});

test("configuration stays lazy across environment loading, updates and replacement", (t) => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  process.env = {};
  expect(config.appUrl).toBe("http://localhost:3000");
  expect(config.databaseUrl).toBe(undefined);
  expect(config.auth.secret).toBe(undefined);
  expect(config.cloudinary.apiSecret).toBe(undefined);
  expect(publicConfig.sentryDsn).toBe(undefined);
  expect(config.playwright).toEqual({
    appUrl: "http://localhost:3000",
    port: undefined,
    reuseServer: false,
  });

  const fields = [
    ["NODE_ENV", () => config.environment],
    ["DATABASE_URL", () => config.databaseUrl],
    ["REDIS_URL", () => config.redisUrl],
    ["APP_URL", () => config.appUrl],
    ["CI", () => config.ci],
    ["BETTER_AUTH_SECRET", () => config.auth.secret],
    ["GOOGLE_CLIENT_ID", () => config.auth.googleClientId],
    ["GOOGLE_CLIENT_SECRET", () => config.auth.googleClientSecret],
    ["CLOUDFLARE_EMAIL_ACCOUNT_ID", () => config.email.accountId],
    ["CLOUDFLARE_EMAIL_API_TOKEN", () => config.email.apiToken],
    ["ACCOUNTS_EMAIL", () => config.email.accountsEmail],
    ["SUPPORT_EMAIL", () => config.email.supportEmail],
    ["CLOUDINARY_CLOUD_NAME", () => config.cloudinary.cloudName],
    ["CLOUDINARY_API_KEY", () => config.cloudinary.apiKey],
    ["CLOUDINARY_API_SECRET", () => config.cloudinary.apiSecret],
    ["CLOUDINARY_URL", () => config.cloudinary.url],
    ["SCHEDULER_SECRET", () => config.schedulerSecret],
    ["NODE_ENV", () => config.analytics.NODE_ENV],
    ["VERCEL_ENV", () => config.analytics.VERCEL_ENV],
    ["GA_MEASUREMENT_ID", () => config.analytics.GA_MEASUREMENT_ID],
    ["GA_ENABLE_IN_DEVELOPMENT", () => config.analytics.GA_ENABLE_IN_DEVELOPMENT],
    ["AHREFS_API_KEY", () => config.integrations.ahrefsApiKey],
    ["GEMINI_API_KEY", () => config.integrations.geminiApiKey],
    ["SENTRY_ORG", () => config.sentry.org],
    ["SENTRY_PROJECT", () => config.sentry.project],
    ["SENTRY_AUTH_TOKEN", () => config.sentry.authToken],
    ["NODE_ENV", () => publicConfig.environment],
    ["NEXT_PUBLIC_SENTRY_DSN", () => publicConfig.sentryDsn],
    ["NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", () => publicConfig.cloudinaryCloudName],
    ["APP_URL", () => publicConfig.appUrl],
  ];
  for (const [key, read] of fields) {
    process.env[key] = ` first ${key} `;
    expect(read(), `${key} preserves its raw value`).toBe(` first ${key} `);
    process.env[key] = `second ${key}`;
    expect(read(), `${key} is read at access time`).toBe(`second ${key}`);
    delete process.env[key];
    expect(read()).toBe(key === "APP_URL" ? "http://localhost:3000" : undefined);
  }
  process.env = { DATABASE_URL: "postgres://replacement", APP_URL: "" };
  expect(config.databaseUrl).toBe("postgres://replacement");
  expect(config.appUrl, "only an absent APP_URL receives the default").toBe("");
  Object.assign(process.env, {
    PLAYWRIGHT_APP_URL: "http://localhost:3100",
    PLAYWRIGHT_PORT: "3100",
    PLAYWRIGHT_REUSE_SERVER: "1",
  });
  expect(config.playwright).toEqual({
    appUrl: "http://localhost:3100",
    port: "3100",
    reuseServer: true,
  });
  process.env.PLAYWRIGHT_REUSE_SERVER = "true";
  expect(config.playwright.reuseServer).toBe(false);
});

test("public configuration exposes only browser-safe values", (t) => {
  const previous = process.env;
  onTestFinished(() => {
    process.env = previous;
  });
  process.env = {
    NODE_ENV: "production",
    APP_URL: "https://smarttools.test",
    NEXT_PUBLIC_SENTRY_DSN: "https://public@example.test/1",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "public-cloud",
    DATABASE_URL: "postgres://private",
    BETTER_AUTH_SECRET: "private-auth-secret",
    CLOUDINARY_API_SECRET: "private-cloudinary-secret",
    SENTRY_AUTH_TOKEN: "private-sentry-token",
    CLOUDFLARE_EMAIL_ACCOUNT_ID: "email-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "private-email-token",
  };
  expect(JSON.parse(JSON.stringify(publicConfig))).toEqual({
    environment: "production",
    appUrl: "https://smarttools.test",
    sentryDsn: "https://public@example.test/1",
    cloudinaryCloudName: "public-cloud",
  });
});
