# SmartTools

SmartTools is a single Next.js application managed with pnpm.

## Application

- `/` — SmartTools discovery and product catalog.
- `/paperwork/*` — invoices, receipts, expenses, mileage, tax, W-9, and 1099 tools.
- `/devtools/*` — browser-based developer utilities.
- `/media/*` — private in-browser image and PDF tools.
- `/admin/*` — permission-gated tools, templates, flags, users, roles, and audit control plane.
- `/auth/*` — authentication and account management with Better Auth.

All routes are served by the root Next.js application on port 3000. Public tools remain anonymous. Authentication reads sessions in-process through `@/lib/auth/index.ts`; Admin additionally requires `admin.enter` and the exact permission for each page or mutation.

## Code layout

- `app/` owns routes; `tools/` owns individual tools.
- `lib/` owns authentication, authorization, cache, configuration, admin logic, and tool/template capabilities.
- `db/` owns database clients, schemas, migration folders, and database scripts.
- `components/ui/` owns the shared design system.
- `package.json` declares all dependencies; `pnpm-workspace.yaml` retains pnpm install policies only.

## Commands

```bash
pnpm dev
pnpm db:migrate <folder>
pnpm db:seed
pnpm admin:promote verified-admin@example.com
pnpm build
pnpm lint
pnpm test
pnpm test:media
```

## Configuration

Application and CLI configuration is read through
`lib/config/config.ts` (`import config from "@/lib/config/config.ts"`), grouped by
service like `config.cloudinary` and `config.auth`. Getters preserve runtime reads
and CLI dotenv loading order; required-value validation stays with each operation.
Browser/shared client modules use `@/lib/config/public.ts`, which contains only
public values. Add new environment reads there or in the server config, rather
than directly in consumers. Next.js loads app environment files; CLI scripts keep
their existing dotenv setup. Test harnesses still set and forward process environments.

## Formatting

Run `pnpm format` to format the workspace or `pnpm format:check` to check it without
changing files. To format a single file, run `pnpm exec prettier --write path/to/file`.

Run `pnpm hooks:install` once to enable the pre-commit hook. It runs tests, then
formats only staged files with `lint-staged`, preserving unstaged edits and adding
the formatting to the commit. Test failures are reported but do not block
formatting or the commit; formatting errors do. `pnpm format` remains available
for formatting the whole workspace.

Prettier uses a pinned local version and the root `.prettierrc.json`: two-space
indentation, double quotes, semicolons, trailing commas, LF line endings, and a
100-column print width. Generated files and copied vendor assets are excluded.
Enable the Prettier extension in your editor and format on save using the workspace
version. Formatting is separate from `pnpm lint`, which checks TypeScript.

## First deployment

1. Copy `.env.example` to `.env.local`, then configure `APP_URL`, one strong `BETTER_AUTH_SECRET`, the database, and any optional integrations you use.
2. Run the fresh-database migration sequence through `0007-generic-assistant` documented under [Generic Assistant migration](#generic-assistant-migration), using `pnpm db:migrate <folder>` for each folder. The baseline preserves anonymous Paperwork tables and adds Auth/control-plane tables and system roles.
3. Run `NODE_ENV=production pnpm db:seed` to seed invoice templates for an empty catalog and missing tool icons. Tools are not seeded: their specs and translations live in the database (see `docs/tools-in-database.md`); a fresh local database comes from `pnpm db:copy`.
4. Deploy the repository root application using its `Dockerfile`.
5. Create and verify the first account, then run `pnpm admin:promote <verified-email>` once.

On Vercel, set `DATABASE_URL` to the **Transaction pooler** connection string from
Supabase's **Connect** dialog (port `6543`), then redeploy. Each Node instance uses
one pooled connection using `pg`, which queues queries on that connection instead
of pipelining them through the transaction pooler. Queries use unnamed statements.
Run migrations using a
direct or session-pooler connection in your local migration environment.

Sentry collects application errors and traces directly from the SDK, without Vercel
Drains. Set `NEXT_PUBLIC_SENTRY_DSN` to your Sentry project's public DSN in Vercel and
redeploy (it is also embedded in the browser build). Leave it empty to disable Sentry.
For readable production stack traces, also set the build variables `SENTRY_ORG`,
`SENTRY_PROJECT`, and the secret `SENTRY_AUTH_TOKEN` with source-map upload permissions.
Uploaded source maps are removed from the build output.

The configuration and server-action helper live in `lib/observability/sentry.ts`;
Next.js loads them through `instrumentation.ts` and `instrumentation-client.ts`.
Errors are captured independently of trace sampling. Traces sample 10% of production
requests (100% in development); adjust `tracesSampleRate` in that module when needed.
In Sentry, use **Issues** for failures and **Traces** for request waterfalls. Server
actions have names such as `serverAction/admin.updateRoleAction`; blog dispatches
include the validated `app.operation`. API routes use the SDK's automatic tracing.
`db.query` and `redis.GET`/`SET`/`DEL`/`EVAL` appear as child spans, including failures.
Database timings exclude pool checkout; Redis includes connection setup and timeouts.
Caught unexpected action/API errors are reported before the existing error responses.
Request bodies, headers, cookies, query parameters, user information, database query
data, and console breadcrumbs are excluded. Session replay and profiling are not enabled.
Verify after deploying by exercising a server action and API request, then checking
their traces and child spans. Sampling means not every successful request appears.

Google OAuth needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Verification, recovery,
and deletion emails use the Cloudflare Email Sending REST API from both Workers and Node deployments.
`EMAIL_PROVIDER=cloudflare` selects the sender and is also the default when omitted.
`lib/email/sender.ts` defines the shared `EmailSender` contract and `getEmailSender` factory;
provider implementations live in `lib/email/senders/`. The Cloudflare class in
`lib/email/senders/cloudflare.ts` owns the provider-specific request and reads its
settings directly from `config.email` when instantiated, without constructor arguments.
Providers implement the contract through type-only imports to avoid a runtime dependency cycle.
The factory selects and instantiates the sender, so authentication consumers keep the same API.
Cloudflare is the currently supported provider; adding another implementation requires
registering it in the factory before selecting its type through configuration.

### Account email setup

1. Enable Workers Paid on the sending account. [Email Sending is in public beta](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/).
   The sender domain must use Cloudflare DNS.
2. Follow [Cloudflare's send-email setup](https://developers.cloudflare.com/email-service/get-started/send-emails/):
   open **Compute > Email Service > Email Sending > Onboard Domain**, select the
   sender domain, and confirm its sending DNS records. Keep the existing Zoho root
   MX records: outbound sending uses `cf-bounce` records, while incoming support mail
   stays in Zoho. Review the domain's existing DMARC policy during onboarding;
   [Email Sending and Email Routing have separate DNS records](https://developers.cloudflare.com/email-service/configuration/domains/).
3. Create an API token scoped to that account with **Email Sending: Edit** permission.
   Set `CLOUDFLARE_EMAIL_ACCOUNT_ID` to the sending account's ID and
   `CLOUDFLARE_EMAIL_API_TOKEN` to that token. These are separate from Wrangler's
   deployment credentials and `CLOUDFLARE_ACCOUNT_ID`.
4. Set `ACCOUNTS_EMAIL=accounts@smarttools.lol` (or a sender on your onboarded domain)
   and `SUPPORT_EMAIL=support@smarttools.lol`. The contact form opens the visitor's
   email app; support messages and replies remain handled in Zoho.
5. Put these settings in `.env.local` for Next.js development/Docker, `.env` for Worker
   preview, `.env.prod` for local production deployment, and the runtime environment
   of any Node deployment. Local Worker deployment uploads the email token as a secret
   and the account ID as a plain-text variable. For Workers Builds, set the token as a
   Worker runtime secret and the account ID and sender as runtime variables before
   deploying; Build Variables do not provide email credentials to the deployed Worker.

After deploying with the new settings, verify signup verification, password recovery,
and deletion confirmation using a controlled account and check Email Sending activity.
Remove the old Resend runtime secret and revoke its token after confirming delivery;
omitting a secret from an environment file does not delete it from an existing Worker.

## Shared Assistant and content

The shared Assistant lifecycle and contracts live in `lib/assistant`, with reusable
panel, composer, reports, and changeset views in `components/assistant`. Register
server integrations statically in `app/api/assistant/integrations.ts`; the core
receives an `AssistantIntegration` and does not import feature implementations.
Blog supplies its permissions, prompts, validation, display projections, and
document application handlers. Paperwork is not integrated yet.

This is a full cutover. Assistant callers use only `/api/assistant/[integrationKey]`
and the shared request/result contracts. The old Blog Assistant routes, wire
adapters, historical payload decoders, and browser-cache migration are removed.
Existing Blog publishing and content APIs remain feature-owned.

`AssistantIntegrationUI` configures agents, labels, select settings, request context,
and application handlers without custom result renderer slots. Canonical artifacts
remain separate from their display projections. The non-Blog fixtures in
`tests/assistant-backend-integration.test.mjs` and
`tests/e2e/assistant-generic.spec.ts` demonstrate integration without a Blog post.

For standalone, read-only Markdown anywhere:

```tsx
import { MarkdownPreview } from "@/components/content/MarkdownPreview";

<MarkdownPreview markdown={content} />
```

It uses standard Markdown headings and paragraph breaks, validates image URLs,
and escapes raw HTML. Blog opts into its own heading/newline settings and retains
its clipboard image validation. The Markdown tool keeps its generated HTML,
sandbox, settings, exports, and synchronized scrolling.

## Database migrations

Run `pnpm db:migrate <folder>` with a folder name under `db/migration/`.
Only that folder's immediate `.sql` files run, in filename order. A folder is required;
there is no default or automatic run of every folder. Prefix SQL filenames with numbers
to control execution order.

The `0001-baseline` folder contains the existing `0001`–`0008` migrations.
Put each new migration batch in its own folder and pass that name to the command.
Migrations run only their SQL; run `pnpm db:seed` separately for templates and icons.
Applied migrations are not tracked; explicitly rerunning a folder runs its SQL again.

On Node deployments, public tool listings, ecosystem navigation, and global search share a
resolved in-memory catalog with a 24-hour TTL. Admin tool edits clear it in the current
process; restart other Node instances after edits that must appear immediately.
Cloudflare Containers use the same Node cache; the current configuration routes the public
and admin hosts to one shared instance. React also deduplicates catalog reads within a page
render. User and authorization caches continue to use Redis.

### Generic Assistant migration

Run `pnpm db:migrate 0007-generic-assistant` before deploying the generic Assistant
application. It creates empty `assistant_threads`, `assistant_runs`,
`assistant_messages`, and `assistant_attachments` tables with integration and
optional resource scope. There is no backfill: it drops `blog_threads`,
`blog_runs`, `blog_messages`, and `blog_attachments`, including their old
conversations, plus the obsolete `protect_blog_run_provider()` function.
Blog content and publishing tables are unchanged. The drops do not use `CASCADE`;
an unexpected dependency causes the transaction to roll back.

The migration runs in one transaction and is safe to rerun without erasing new
Assistant records. Rerun `0007` if the fresh Assistant tables were already created
before legacy-table removal was added. It requires the authentication tables but
does not depend on the old Blog Assistant tables. Their obsolete migrations
`0003` through `0006` have been removed from the repository.

For a **fresh empty database**, execute `0001-baseline`, `0002-tool-icon-url`,
then `0007-generic-assistant`. Run `pnpm db:seed` separately. Existing deployments
run `0007` directly; do not recreate the removed legacy migrations.

For deployment, pause new Assistant writes and maintenance, allow active requests
to settle, take a database snapshot, run `0007`, deploy schema-compatible code,
and resume requests and maintenance. Keep `assistant_*` tables intact during a
rollback and use schema-compatible application code. An older application that
requires the removed Blog Assistant tables needs the pre-migration snapshot;
restoring that snapshot must account for writes made after it was taken.

Run the fresh-schema, legacy-removal, replay, scope-isolation, and deletion-order checks against
a disposable PostgreSQL database with
`ASSISTANT_TEST_DATABASE_URL=postgresql://... node --test tests/assistant-migration.test.mjs`.
These tests create and remove temporary schemas and deliberately never fall back
to `DATABASE_URL`.

Assistant retention and provider-resource cleanup runs at 00:00 and 12:00 UTC daily,
independently of Blog publication's 30-minute Worker schedule. Set
`SCHEDULER_SECRET` to the same random bearer secret in the application
and scheduler environment. Leave `ASSISTANT_MAINTENANCE_URL` empty to use the
Worker's self binding, or set it to an HTTPS Docker endpoint ending exactly in
`/api/internal/assistant/maintenance`. Blog publishing and Assistant maintenance
share this secret; each cron trigger invokes only its corresponding operation.
Assistant cleanup is invoked only through its independent maintenance endpoint;
Blog publishing no longer invokes conversation cleanup.

For existing databases, run `pnpm db:migrate 0002-tool-icon-url` before deploying the
updated app. It adds `managed_tools.icon_url`, preserves existing URLs, backfills
legacy Cloudinary icons, and drops `tool_icons` in one transaction. Set
`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (or `CLOUDINARY_CLOUD_NAME`) to the existing
icons' cloud; it is required only when legacy icons need backfilling. A failure
rolls back the schema and data changes. The folder is safe to rerun. Fresh setups
continue through the Assistant migration sequence above before running `db:seed`.

`db:seed` seeds invoice templates, uploads SVG icons to Cloudinary, then assigns
missing icons by tool slug. Existing database icon assignments and Cloudinary assets
are preserved. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET`. If `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` is set, use the
same cloud. Complete delivery URLs are stored on each tool. Set `NODE_ENV` to
`development`, `test`, or `production`.

Icons default to `scripts/seed-assets/tool-icons`, included in Git for fresh setups.
They stay outside `public` and are excluded from Next.js output tracing, so they
are not shipped in the production application bundle or final Docker runtime image.
To use another SVG directory, with filenames matching tool slugs:

```bash
NODE_ENV=development pnpm db:seed --icons-dir /path/to/icons
```

A failed step stops seeding. The upload manifest stays at
`tmp/icons-prod.json` or `tmp/icons-dev.json` inside the checkout after both
successful and failed runs. Reruns reuse successful uploads for the same Cloudinary
cloud, folder, and SVG directory, process new or unfinished icons, and preserve existing database assignments.
Use the standalone uploader's `--overwrite` option to replace existing assets.
Database migrations remain a separate command.

## Admin subdomain on Vercel

The public site and admin use the same Vercel project and deployment. The admin
origin is derived automatically from `APP_URL`: `https://example.com` and
`https://www.example.com` both use `https://admin.example.com`, with paths such
as `/users` and `/tools`. There is no separate admin URL setting.

1. Add `admin.example.com` to the project's **Settings → Domains**, assigned to
   Production. Add the exact CNAME record Vercel displays at your DNS provider
   and wait for domain verification and HTTPS.
2. Set the public site's URL for the production build:

   ```dotenv
   APP_URL=https://example.com
   ```

   Use an HTTPS origin without a path. The derived admin URL preserves the
   protocol and port, removes a leading `www.`, and prefixes the hostname with
   `admin.`. Keep `BETTER_AUTH_SECRET` unchanged.
3. If using Google login, register both callbacks with the OAuth provider:
   `https://example.com/api/auth/callback/google` and
   `https://admin.example.com/api/auth/callback/google`.
4. Redeploy. `APP_URL` must be available at build time so server and browser
   navigation agree; changing it requires a new deployment. IP addresses and
   `*.vercel.app` values retain `/admin` routes instead of deriving a subdomain.
   Bare `localhost` derives `admin.localhost` for development.

The app internally rewrites admin pages to `app/admin`; browser URLs have no
`/admin` prefix. Old `/admin/...` page URLs redirect to the corresponding clean
admin URL, preserving queries. APIs, authentication, and assets retain their
existing paths. Mutations to legacy paths on the public host return 404 instead
of forwarding their request bodies to the admin host.

On real domains, login is shared with cookies scoped to the common parent
hostname. All subdomains within that cookie scope must be trusted. Authentication
and the request proxy use `config.auth.cookiePrefix`, configured through
`AUTH_COOKIE_PREFIX` (default:
`smarttools`). Keep the same value on both hosts. Login and logout apply to both
hosts. Existing server-side admin permissions remain required.
Admin responses are marked `noindex`, and its `robots.txt` disallows crawling.

Before switching an existing deployment to shared-domain cookies, clear existing
cookies for both the public and admin hosts, then sign in again. Existing
host-only cookies do not migrate to the shared domain; keep the `smarttools`
cookie prefix unchanged.

After deploying, verify login from both hosts, navigation to `/users` and `/tools`,
an admin save, logout on both hosts, and a public-page link from admin.

### Local development

Keep `APP_URL=http://localhost:3000` in `.env.local`, then start or restart
`pnpm dev`. The public site runs at `http://localhost:3000` and admin at
`http://admin.localhost:3000`, with clean paths such as `/users` and `/tools`.

For Google login, register this local OAuth callback:
`http://localhost:3000/api/auth/callback/google`. Google sign-in starts and
returns on `localhost`, including when initiated from `admin.localhost`.
Local development uses a session handoff to establish host-only cookies on both
hosts because browsers do not reliably share `Domain=localhost` cookies. The
cookies refer to the same backend session, so logout invalidates access on both
hosts. Production domains continue to use shared-domain cookies and callbacks
on the host where Google sign-in began.

To check the flow, sign in at `http://localhost:3000` with a verified account that
has admin access. If needed, grant that existing account access with
`pnpm admin:promote you@example.com`. Open the account menu's admin link and
confirm it reaches `http://admin.localhost:3000` without another login. Check
`/users`, return to the public site, and confirm that logging out signs out both
hosts. Opening `http://localhost:3000/admin/users` should redirect to
`http://admin.localhost:3000/users`. Also verify the deployed flow on the real
HTTPS domain.

### Register another subdomain

`lib/config/subdomains.ts` is the registry for subdomains served by this app.
Only `admin` is currently registered. To add another scope, add one entry to
`SUBDOMAINS`; for example, a future billing scope could use:

```ts
billing: { routePrefix: "/billing", indexable: false },
```

Create its pages beneath that route prefix, such as
`app/billing/invoices/page.tsx`. The registered name determines the hostname:
`billing.example.com/invoices` serves the internal `/billing/invoices` route.
Use `appHref("/billing/invoices")` or `subdomainHref("billing", "/invoices")`
from `lib/routing/subdomains.ts` for links and redirects. For section pages, these
helpers retain the internal route prefix when `APP_URL` uses a host without
subdomain support.
Use `getSubdomainOrigin`, `getSubdomainOrigins`, and `internalSubdomainPath`
from the same module when resolving origins or internal route identities.

Shared authentication automatically trusts the configured public origin and
registered subdomain origins. Each route scope still owns its server-side
permission checks. `/api`, `/auth`, `/account`, `/_next`, `/assets`, `/tool-icons`,
`/media/vendor`, and `/media/licenses`, plus shared logo and favicon files, are
reserved shared paths and are not rewritten into a subdomain's route prefix.

With `indexable: false`, responses receive `noindex`, `robots.txt` disallows
crawling, and `sitemap.xml` returns 404. With `indexable: true`, the scope must
provide its own robots and sitemap routes beneath its route prefix; the public
site's root robots or sitemap are never used as a fallback.

For production, add the new hostname and DNS record at the hosting provider,
and register its OAuth callback if using Google login. These steps remain manual.
Restart development or rebuild and redeploy after changing the registry or
`APP_URL`.

## Cloudflare Containers

Cloudflare Container deployment is currently dormant. The manual `pnpm run deploy` and `pnpm run deploy:preview`
commands still publish to Cloudflare if intentionally invoked, but GitHub Actions
no longer builds or publishes a Cloudflare image. The production Worker is configured
for **https://smarttools.lol** and **https://admin.smarttools.lol**; preview uses
**https://canopy-dev.aashishpal50.workers.dev**.
The Worker forwards requests to `CanopyContainer`; the standalone Next.js server runs
inside the container on port 3000, including authentication, admin pages, API routes,
streaming responses, and static files. The existing application login and admin
permissions apply.

The Worker and container application identities are `canopy` and `canopy-dev`;
SmartTools remains the public brand. These names create new deployment identities
and do not rename existing cloud resources or copy their settings. For production
cutover, configure the new Worker's runtime secrets, move the public and admin
custom domains, and reconnect Workers Builds to `canopy`. Disable the old Worker's
cron triggers before enabling the new Worker's triggers to avoid duplicate jobs.
Retain the existing authentication secret and cookie prefix so sessions remain
compatible. Existing cloud resources require a separate, deliberate cutover.

Each environment uses one shared container instance and sleeps after two idle
minutes. The first request after sleeping starts the container, so allow for a cold
start. A single instance limits the initial deployment's resource footprint; it is
not automatic horizontal scaling. Container CPU, memory, disk, and network usage
have their own charges in addition to the Worker and Durable Object. Check the
[Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
and measured usage before changing instance size or idle time.

### Configure once

1. Enable Workers Paid and configure the `smarttools.lol` Cloudflare DNS zone for
   production's public and admin custom domains. The dev Worker uses workers.dev.
2. Install and start a Docker-compatible engine, then run `pnpm exec wrangler login`.
   Local builds and deployments build the repository's Dockerfile. Workers Builds
   can also build the image in CI.
3. Prepare `.env.prod` with production settings and `.env` with dev settings. These
   files are ignored by Git. Include the applicable values from `.env.example`:
   - `DATABASE_URL` — required at runtime. Containers use PostgreSQL's Node driver
     and the existing connection pool (`DATABASE_POOL_MAX`, default 3). Hyperdrive
     is no longer bound to the Worker. Use a database endpoint reachable from the
     container; for Supabase, use an appropriate pooler connection.
   - `BETTER_AUTH_SECRET` — retain the existing persistent authentication secret.
   - `CLOUDFLARE_EMAIL_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `ACCOUNTS_EMAIL`
     — the [onboarded account-email sender](#account-email-setup).
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` if using Google login.
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
     if using admin image uploads.
   - `SCHEDULER_SECRET` — one shared bearer secret for all internal cron jobs.
     Generate it with `openssl rand -hex 32`, add it to `.env.prod`, and run
     `pnpm run deploy` to upload it and roll out the matching container environment.
     Production retains the cron timings and points its
     Worker self binding to `canopy`; leave external target URLs unset.
   - Other integrations used by the app, including `REDIS_URL` if enabled.
4. If using Google login, retain the production callbacks
   `https://smarttools.lol/api/auth/callback/google` and
   `https://admin.smarttools.lol/api/auth/callback/google`. Register the new preview
   callback `https://canopy-dev.aashishpal50.workers.dev/api/auth/callback/google`.
5. Database migrations and initial seeding remain separate, explicit operations.
   The container build, startup, and deployment do not run them. Existing databases
   need no migration solely to change hosting.

### Build settings and runtime secrets

Local `pnpm run build:cloudflare` and `pnpm run deploy` read `.env.prod`;
`pnpm run deploy:preview` and `pnpm run preview` read `.env`. Commands stop if their
selected file is missing and do not edit environment files. Other dotenv files
and inherited application values cannot supply missing settings. Docker excludes
all dotenv files, `.dev.vars`, local dependencies, and prior build outputs.

Docker connection settings come from the invoking shell and Docker's active
context, not `.env` or `.env.prod`. Export `DOCKER_HOST`, `DOCKER_CONTEXT`, or
`WRANGLER_DOCKER_BIN` in your shell only when overriding the active Docker setup.

`APP_URL` comes from the selected `wrangler.jsonc` environment:
`https://smarttools.lol` for production and
`https://canopy-dev.aashishpal50.workers.dev` for dev. Local preview overrides
both the image build and Worker to `http://localhost:8787`. The selected file cannot
override that origin. Each image must be built for its public origin because
Next.js embeds it into browser navigation and admin URLs.

Only `APP_URL`, `NEXT_PUBLIC_*` values, and a random public deployment revision enter
Docker build arguments. The wrapper
passes public settings as `CANOPY_PUBLIC_BUILD_ENV` JSON using Wrangler's
`containers[].image_vars`. For example, set `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
and `NEXT_PUBLIC_SENTRY_DSN` in the selected environment file before building.
Changing a public value requires rebuilding the image. The Dockerfile creates a
random, disposable Better Auth key inside the build process for route collection;
the deployed app receives its persistent key only when the container starts.
`SENTRY_AUTH_TOKEN` is never forwarded as an image build argument. This workflow
does not upload source maps with private build credentials.

For local deploy commands, known basic settings such as `CACHE_ENABLED`,
`AI_ENABLED`, `OPENAI_MODEL`, and `CLOUDFLARE_EMAIL_ACCOUNT_ID` become plain Worker
variables. Credentials and unknown settings are uploaded using a temporary secrets
file with owner-only permissions, which is removed after success or failure.
The Worker passes the explicit application settings in `worker.ts` to the container
at startup; add any new runtime setting there as well. Deployed settings omitted
from a later file are retained; removing a line does not delete a remote secret.
Never put runtime secrets in Docker build arguments.

**Runtime changes require a completed container rollout.** A running container
retains its startup environment. The deployment wrapper adds a new random
`CANOPY_DEPLOYMENT_REVISION` to the final image label on every invocation. This
changes the image digest without putting secrets into the image, so even a deployment
that only changes Worker settings replaces the running container. The label is
applied after copying the app, allowing Docker to reuse its existing build layers.
See [startup environment behavior](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)
and [deployment behavior](https://developers.cloudflare.com/containers/guides/deploy/).

After editing runtime settings, run `pnpm run deploy:preview` for dev or
`pnpm run deploy` for production, including when values were changed through the
Cloudflare dashboard. In **Workers & Pages > Containers**, select the application
associated with `canopy-dev` or `canopy` and confirm the old process is
replaced and requests reach the healthy new instance. Complete this for every
environment whose settings changed. A Worker-only deployment, direct
`wrangler secret put`, or `wrangler versions upload` does not guarantee a restart.

Schedule secret rotations between cron runs. The shared `SCHEDULER_SECRET`
must match between the Worker and container;
a cron invocation during the update/rollout gap can receive `401`. Verify both jobs
after rotation. The deployment is not transactional and this single-instance
replacement can briefly interrupt requests. Changing dashboard settings without
running the wrapper leaves those settings pending until a real container restart;
continuous traffic can prevent the two-minute idle shutdown.

### Verify and deploy

```bash
node --test tests/cloudflare-build.test.mjs
pnpm lint
# Build a local linux/amd64 image and check the Worker bundle without uploading:
pnpm run build:cloudflare
# Build and run locally at http://localhost:8787 with .env:
pnpm run preview
# Deploy and test the separate dev environment first:
pnpm run deploy:preview
# Publish production after verification:
pnpm run deploy
```

Local preview needs a running Docker engine. A database on your computer must be
reachable from the container; `localhost` inside Docker refers to the container.
On Docker Desktop, use `host.docker.internal` for a host database. Use `pnpm dev`
for the ordinary Next.js development loop.

Dev has no scheduled cron triggers and its self binding points to `canopy-dev`.
Dev admin stays at `/admin`; production admin uses `https://admin.smarttools.lol`.
Check login, account recovery, admin reads/writes, tool execution, Paperwork/PDF
exports, Media processing, and AI streaming before production. Confirm both production
jobs: blog publication every 30 minutes and assistant cleanup at 00:00 and 12:00 UTC.
Verify container startup and a fresh request after idle sleep as well.

Deployment uploads Worker code and updates the container image; these are not one
transaction, and initial provisioning or a rollout may take several minutes.
Retain the previous Worker version and container image before cutover. A Worker
rollback alone does not revert its container image or database. See the
[deployment guide](https://developers.cloudflare.com/containers/guides/deploy/)
and [container rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/).

### Workers Builds

Connect the production branch to the `canopy` Worker, using the
repository root. Configure Node and pnpm versions supported by the repository
(`NODE_VERSION=26`, `PNPM_VERSION=11.14.0`), leave the build command empty, and set
the deploy command to `pnpm run deploy`. The Dockerfile controls the container's
Node version independently.

The wrapper recognizes `WORKERS_CI` and deploys with `--keep-vars`, preserving
existing Worker runtime variables and secrets without reading `.env.prod`.
Before the first container deployment from CI, configure all runtime settings and
secrets on the new Worker, including `DATABASE_URL`, `BETTER_AUTH_SECRET`, and
`SCHEDULER_SECRET`; settings from the old Worker are not copied automatically. Configure public
`NEXT_PUBLIC_*` settings as Build Variables. Runtime secrets are not required in
Build Variables. CI target checks and deployment output settings are retained.

Use the separate `canopy-dev` environment for remote testing; ordinary
`wrangler versions upload` does not publish a new container image. The package
scripts reject extra arguments and inherited `CLOUDFLARE_ENV` to avoid targeting
an unintended environment. Use explicit `pnpm run deploy`, since pnpm also has a
built-in command named `deploy`.

## Optional Google Analytics 4

Set `GA_MEASUREMENT_ID` to your public `G-...` web-stream ID in Vercel's
**Production** environment, then redeploy. Tracking is disabled by default in
development, always in Vercel previews, and without a valid ID. To test locally,
set `GA_ENABLE_IN_DEVELOPMENT=true` in `.env.local` and restart `pnpm dev`.
This enables the consent banner and real GA4 events after opt-in; remove the
override when finished. No new dependency is required.

Before enabling production collection, open GA4 Admin → Data streams → your web
stream and turn **Enhanced measurement off**. Automatic history, form, search,
and download events can bypass the application's filtered event payloads. Keep
Google signals, user-provided data collection, and advertising personalization off.

Visitors must allow analytics before the Google script loads. They can change or
withdraw consent at `/privacy#analytics`; withdrawal stops future collection and
removes host-only analytics cookies, but does not erase data already sent. A
blocked preference store makes the choice temporary until reload. Ad blockers or
failed script loads may prevent collection; reload to retry.

Manual page views exclude private routes, queries, fragments, and arbitrary tool
slugs. Tool pages use `/media/[tool]`, `/devtools/[tool]`, or `/paperwork/[tool]`.
Shared manual tool runs emit `tool_start`, `tool_complete`, and `tool_error`;
shared result controls emit `result_copy` after copying and `result_download`
when a download starts. Live typing and tool-owned custom controls are not
instrumented. Events include the compiled `tool_key` when available; create an
event-scoped GA4 custom dimension for `tool_key` to report per-tool usage.
Files, document content, account details, filenames, and error messages are never
included. External referrers are reduced to their origin; internal referrers use
the previous filtered public address.

Verify the deployed site with GA4 Realtime after opting in. Confirm that decline
loads no Google tag, navigation sends one page view, and withdrawal stops events.
