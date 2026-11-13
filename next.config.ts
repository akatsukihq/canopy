import config from "./lib/config/config.ts";
import publicConfig from "./lib/config/public.ts";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import withSerwistInit from "@serwist/next";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import createNextIntlPlugin from "next-intl/plugin";
import { locales, localizeHref } from "./lib/i18n/config";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const browserEmptyModule = fileURLToPath(new URL("./lib/paperwork/browserEmptyModule.ts", import.meta.url));
const development = config.environment !== "production";
const sentryOrigin = publicConfig.sentryDsn ? new URL(publicConfig.sentryDsn).origin : "";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://res.cloudinary.com https://*.google-analytics.com https://*.googletagmanager.com",
  "font-src 'self'",
  `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com${sentryOrigin ? ` ${sentryOrigin}` : ""}${development ? " ws: http:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const mediaSecurityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const workerIsolationHeaders = [{ key: "Cross-Origin-Embedder-Policy", value: "require-corp" }];

// Baseline for every route. No Content-Security-Policy here: the strict one above blocks AdSense, which public pages load.
// `/media` rules come later in headers(), so their stricter Referrer-Policy and frame rules win for the same key.
const siteSecurityHeaders = [
  ...(development ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
];

// Search engines treat www and the apex as two sites, so send www to the canonical origin with one permanent hop.
const appOrigin = new URL(config.appUrl);
const wwwRedirects =
  appOrigin.protocol === "https:" && !appOrigin.hostname.startsWith("www.")
    ? [
        {
          source: "/:path*",
          has: [{ type: "host" as const, value: `www.${appOrigin.hostname}` }],
          destination: `${appOrigin.origin}/:path*`,
          permanent: true,
        },
      ]
    : [];

const nextConfig: NextConfig = {
  // Only the public product URL is exposed; authentication secrets stay server-side.
  env: { APP_URL: config.appUrl },
  output: "standalone",
  outputFileTracingRoot: appRoot,
  outputFileTracingExcludes: {
    "/*": ["./scripts/seed-assets/**/*"],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    globalNotFound: true,
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  turbopack: {
    resolveAlias: {
      "@": appRoot,
      // Browser shims for Node builtins pulled in transitively by the paperwork
      // PDF stack (@pdfme/*, @react-pdf/renderer, fontkit). No first-party code
      // imports these. Mirrors the webpack() aliases below so `next build` and
      // `next dev` resolve identically.
      module: { browser: "./lib/paperwork/browserEmptyModule.ts" },
      "fs/promises": { browser: "./lib/paperwork/browserEmptyModule.ts" },
      url: { browser: "./lib/paperwork/browserEmptyModule.ts" },
      zlib: { browser: "./lib/paperwork/browserEmptyModule.ts" },
    },
  },
  webpack(config, { isServer, webpack }) {
    config.resolve.alias["@"] = appRoot;
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      Object.assign(config.resolve.alias, {
        "fs/promises": browserEmptyModule,
        module: browserEmptyModule,
        url: browserEmptyModule,
        zlib: browserEmptyModule,
      });
    }
    return config;
  },
  transpilePackages: [
    "@jsquash/jpeg",
    "@jsquash/oxipng",
    "@jsquash/png",
    "@jsquash/resize",
    "@jsquash/webp",
    "heic-to",
    "pdfjs-dist",
    "qpdf-wasm",
  ],
  async redirects() {
    return wwwRedirects;
  },
  async headers() {
    return [
      { source: "/:path*", headers: siteSecurityHeaders },
      { source: "/media/:path*", headers: mediaSecurityHeaders },
      { source: `/:locale(${locales.join("|")})/media/:path*`, headers: mediaSecurityHeaders },
      {
        // Version-named vendor files never change in place, so they cache for a year.
        source: "/code/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/_next/static/:path*",
        headers: workerIsolationHeaders,
      },
    ];
  },
};

// Serwist compiles `app/sw.ts` into `public/sw.js` during `next build --webpack`.
// Turbopack `next dev` cannot run the webpack-based plugin, so the service
// worker is disabled in development — test offline via `pnpm build && pnpm start`.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Dynamic locale routes are not part of the static asset manifest. Cache
  // each public fallback with this build's asset revision so updates replace
  // HTML that references an older set of chunks.
  manifestTransforms: [
    async (entries) => {
      const revision = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
      return {
        manifest: [
          ...entries,
          ...locales.map((locale) => ({ url: localizeHref("/offline", locale), revision, size: 0 })),
        ],
        warnings: [],
      };
    },
  ],
  // Every public file is precached except PGlite (~16 MB): only visitors who pick PostgreSQL download it,
  // then the browser keeps it (immutable /code/vendor headers). Globs here cannot negate, so list the rest.
  globPublicPatterns: ["*", "!(code)/**/*", "code/!(vendor)/**/*", "code/vendor/!(pglite)/**/*"],
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: development,
});

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  org: config.sentry.org,
  project: config.sentry.project,
  authToken: config.sentry.authToken,
  release: { name: config.environment ?? "development" },
  silent: !config.ci,
  telemetry: false,
  sourcemaps: {
    // Temporarily disabled to reduce Vercel build memory usage.
    disable: true,
    deleteSourcemapsAfterUpload: true,
  },
});
