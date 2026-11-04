import type { ReactNode } from "react";
import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import { Caption, Card, H2, InlineCode, P, StatusBadge } from "@/components/ui/index.tsx";
import { asc, db, isDatabaseConfigured, systemLimitsTable } from "@/db/index.ts";
import { requirePagePermission } from "@/lib/admin/access";
import { getUserAuthorization } from "@/lib/admin/index.ts";
import { hasPermission } from "@/lib/authorization/index.ts";
import config from "@/lib/config/config.ts";
import * as codeLimits from "@/lib/tool-framework/limits";
import { DATABASE_SYSTEM_LIMITS } from "@/lib/tool-framework/systemLimits";
import { SystemLimitForm } from "./components/SystemLimitForm";
import { formatLimit, limitLabel, type LimitUnit } from "./lib/limitUnits";

export const dynamic = "force-dynamic";

/** What the runtime actually enforces for a limit that is still a code constant. */
const CODE_VALUES: Readonly<Record<string, number>> = {
  platform_max_bytes: codeLimits.PLATFORM_MAX_BYTES,
  blob_fallback_max_bytes: codeLimits.BLOB_FALLBACK_MAX_BYTES,
  max_editable_text_chars: codeLimits.MAX_EDITABLE_TEXT_CHARS,
  large_text_preview_bytes: codeLimits.LARGE_TEXT_PREVIEW_BYTES,
  csv_preview_rows: codeLimits.CSV_PREVIEW_ROWS,
  csv_preview_bytes: codeLimits.CSV_PREVIEW_BYTES,
  csv_max_field_bytes: codeLimits.CSV_MAX_FIELD_BYTES,
  csv_max_row_bytes: codeLimits.CSV_MAX_ROW_BYTES,
  pdf_thumbnail_cache_size: codeLimits.PDF_THUMBNAIL_CACHE_SIZE,
  pdf_preview_max_width: codeLimits.PDF_PREVIEW_MAX_WIDTH,
  pdf_preview_max_pixels: codeLimits.PDF_PREVIEW_MAX_PIXELS,
  pdf_preview_cache_pixels: codeLimits.PDF_PREVIEW_CACHE_PIXELS,
};

const configured = (...values: (string | undefined)[]) => values.every((value) => Boolean(value?.trim()));

function SetBadge({ ok }: { ok: boolean }) {
  return <StatusBadge variant={ok ? "success" : "neutral"}>{ok ? "Configured" : "Not set"}</StatusBadge>;
}

/** Read-only environment facts. Secrets are reported as set or not, never shown. */
function environmentRows(): { label: string; value: ReactNode; note: string }[] {
  const ai = config.ai;
  return [
    { label: "Environment", value: <InlineCode>{config.environment ?? "unknown"}</InlineCode>, note: "NODE_ENV" },
    { label: "Public site URL", value: <InlineCode>{config.appUrl}</InlineCode>, note: "APP_URL" },
    {
      label: "Response cache",
      value: (
        <StatusBadge variant={config.cacheEnabled ? "success" : "neutral"}>
          {config.cacheEnabled ? "On" : "Off"}
        </StatusBadge>
      ),
      note: "CACHE_ENABLED; off by default in development",
    },
    { label: "Redis", value: <SetBadge ok={configured(config.redisUrl)} />, note: "REDIS_URL" },
    {
      label: "Database pool size",
      value: config.databasePoolMax.toLocaleString("en"),
      note: "DATABASE_POOL_MAX; connections per server instance",
    },
    {
      label: "Google sign-in",
      value: <SetBadge ok={configured(config.auth.googleClientId, config.auth.googleClientSecret)} />,
      note: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
    },
    {
      label: "Email",
      value: <SetBadge ok={configured(config.email.accountId, config.email.apiToken)} />,
      note: `Provider ${config.email.provider}; CLOUDFLARE_EMAIL_*`,
    },
    {
      label: "AI features",
      value: <StatusBadge variant={ai.enabled ? "success" : "neutral"}>{ai.enabled ? "On" : "Off"}</StatusBadge>,
      note: `AI_ENABLED; provider ${ai.provider}, model ${ai.openai.model}`,
    },
    { label: "OpenAI key", value: <SetBadge ok={configured(ai.openai.apiKey)} />, note: "OPENAI_API_KEY" },
    {
      label: "Image uploads",
      value: <SetBadge ok={configured(config.cloudinary.url) || configured(config.cloudinary.cloudName)} />,
      note: "CLOUDINARY_*; tool icon uploads",
    },
    {
      label: "Analytics",
      value: <SetBadge ok={configured(config.analytics.GA_MEASUREMENT_ID)} />,
      note: "GA_MEASUREMENT_ID",
    },
    {
      label: "Error reporting",
      value: <SetBadge ok={configured(config.sentry.org, config.sentry.project)} />,
      note: "SENTRY_ORG, SENTRY_PROJECT",
    },
  ];
}

export default async function SettingsPage() {
  const session = await requirePagePermission("settings", "view");
  const [{ access }, limits] = await Promise.all([
    getUserAuthorization(session.user.id),
    isDatabaseConfigured() ? db.select().from(systemLimitsTable).orderBy(asc(systemLimitsTable.key)) : [],
  ]);
  const canEdit = hasPermission(access, "settings", "edit");
  const editable = limits.filter((limit) => DATABASE_SYSTEM_LIMITS.includes(limit.key));
  const fixed = limits.filter((limit) => !DATABASE_SYSTEM_LIMITS.includes(limit.key));

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto">
      <AdminPageHeader
        className="mb-0 shrink-0"
        description="Platform-wide limits and environment configuration. Editable limits apply on the next request; everything else is set in code or the server environment."
        title="Settings"
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-labelledby="limits-heading" className="grid gap-5">
          <Card className="p-0">
            <div className="border-b border-border px-5 py-4">
              <H2 className="text-base" id="limits-heading">
                Tool limits
              </H2>
              <Caption className="text-muted-foreground">
                Caps every tool&apos;s file sizes and text length. A tool asking for more is capped to these values, and
                saving a definition above them is rejected.
                {canEdit ? null : " You can view these limits but not change them."}
              </Caption>
            </div>
            {editable.length ? (
              <ul className="divide-y divide-border">
                {editable.map((limit) => (
                  <li className="flex flex-wrap items-start justify-between gap-4 px-5 py-4" key={limit.key}>
                    <div className="min-w-0 max-w-md">
                      <P className="font-medium">
                        {limitLabel(limit.key)}: {formatLimit(limit.value, limit.unit as LimitUnit)}
                      </P>
                      <Caption className="text-muted-foreground">{limit.description}</Caption>
                      <Caption className="block text-muted-foreground">
                        Key <InlineCode>{limit.key}</InlineCode>
                      </Caption>
                    </div>
                    <SystemLimitForm
                      canEdit={canEdit}
                      label={limitLabel(limit.key)}
                      limitKey={limit.key}
                      unit={limit.unit as LimitUnit}
                      updatedAt={limit.updatedAt.toISOString()}
                      value={limit.value}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <P className="px-5 py-4 text-muted-foreground">
                No system limits are stored. Run the <InlineCode>0009-tool-spec</InlineCode> migration.
              </P>
            )}
          </Card>

          {fixed.length ? (
            <Card className="p-0">
              <div className="border-b border-border px-5 py-4">
                <H2 className="text-base">Preview and memory limits</H2>
                <Caption className="text-muted-foreground">
                  View only. These are still enforced by <InlineCode>lib/tool-framework/limits.ts</InlineCode>; change
                  them in code and deploy.
                </Caption>
              </div>
              <dl className="divide-y divide-border">
                {fixed.map((limit) => (
                  <div className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4" key={limit.key}>
                    <dt className="min-w-0">
                      <P className="font-medium">{limitLabel(limit.key)}</P>
                      <Caption className="text-muted-foreground">{limit.description}</Caption>
                    </dt>
                    <dd className="flex items-center gap-2 text-sm sm:justify-end">
                      {formatLimit(CODE_VALUES[limit.key] ?? limit.value, limit.unit as LimitUnit)}
                      <StatusBadge variant="neutral">Set in code</StatusBadge>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}
        </section>

        <Card aria-labelledby="environment-heading" className="p-0" role="region">
          <div className="border-b border-border px-5 py-4">
            <H2 className="text-base" id="environment-heading">
              Environment
            </H2>
            <Caption className="text-muted-foreground">
              View only. Set as server environment variables; changes need a restart or redeploy. Secret values are
              never shown.
            </Caption>
          </div>
          <dl className="divide-y divide-border">
            {environmentRows().map((row) => (
              <div className="flex items-start justify-between gap-4 px-5 py-3" key={row.label}>
                <dt className="min-w-0">
                  <P className="font-medium">{row.label}</P>
                  <Caption className="break-words text-muted-foreground">{row.note}</Caption>
                </dt>
                <dd className="shrink-0 text-sm">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
