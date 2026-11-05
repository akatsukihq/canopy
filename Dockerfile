# syntax=docker/dockerfile:1

ARG NODE_VERSION=26-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.14.0
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace manifest must be here, or `pnpm build` sees stale deps and reinstalls.
COPY --parents packages/*/package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --frozen-lockfile

FROM dependencies AS builder
COPY . .
# Next webpack needs more heap during compilation than the default ~2 GiB.
# This setting stays in the builder and does not increase the runtime heap.
ENV NODE_OPTIONS="--max-old-space-size=4096"
ARG APP_URL
# Only public values belong in image build arguments. Runtime secrets are supplied
# by the deployment platform when the container starts.
ARG CANOPY_PUBLIC_BUILD_ENV={}
RUN test -n "$APP_URL" && mkdir -p public
RUN node --input-type=module <<'NODE'
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const publicValues = JSON.parse(process.env.CANOPY_PUBLIC_BUILD_ENV);
if (!publicValues || Array.isArray(publicValues) || Object.entries(publicValues).some(([key, value]) => !/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(key) || typeof value !== "string")) {
  throw new Error("Only NEXT_PUBLIC_ string values may be passed to the image build.");
}
const result = spawnSync("pnpm", ["build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...publicValues,
    // Better Auth initializes during route collection. Never bake the live key
    // into image metadata or build arguments; this key only lives in this process.
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  },
});
if (result.error) throw new Error("Unable to start the application build.");
process.exit(result.status ?? 1);
NODE

FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
# bookworm-slim has no curl/wget, so probe with node. Coolify picks this up automatically.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
