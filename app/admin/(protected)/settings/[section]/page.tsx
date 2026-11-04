import type { ReactNode } from "react";
import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import { Caption, InlineCode, P, StatusBadge } from "@/components/ui/index.tsx";
import { asc, db, isDatabaseConfigured, managedToolsTable, systemLimitsTable } from "@/db/index.ts";
import { requirePagePermission } from "@/lib/admin/access";
import { getUserAuthorization } from "@/lib/admin/index.ts";
import { hasPermission } from "@/lib/authorization/index.ts";
import config from "@/lib/config/config.ts";
import { DATABASE_SYSTEM_LIMITS } from "@/lib/tool-framework/systemLimits";
import Link from "next/link";
import { getRuntimeSettingsCardProps } from "@/lib/admin/runtimeSettings.ts";
import { notFound } from "next/navigation";
import { RuntimeSettingRow } from "../components/RuntimeSettingRow";
import { SettingRow, SettingsSection } from "../components/SettingRow";
import { SystemLimitForm } from "../components/SystemLimitForm";
import { formatLimit, limitLabel, type LimitUnit } from "../lib/limitUnits";
import { toolsOverLimits } from "../lib/overLimitTools";
import { SETTINGS_SECTIONS } from "../lib/sections";

export const dynamic = "force-dynamic";

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
      label: "AI provider",
      value: <InlineCode>{ai.provider}</InlineCode>,
      note: "AI_PROVIDER; on/off and models are under Settings → AI",
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

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const session = await requirePagePermission("settings", "view");
  const slug = (await params).section;
  const section = SETTINGS_SECTIONS.find((entry) => entry.slug === slug);
  if (!section) notFound();

  const { access } = await getUserAuthorization(session.user.id);
  const canEdit = hasPermission(access, "settings", "edit");
  const readOnly = canEdit || section.slug === "environment" ? "" : " You can view these settings but not change them.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto">
      <AdminPageHeader className="mb-0 shrink-0" description={section.description + readOnly} title={section.label} />
      <SettingsSection>
        {section.slug === "limits" ? (
          <LimitRows canEdit={canEdit} />
        ) : section.slug === "environment" ? (
          environmentRows().map((row) => (
            <SettingRow description={row.note} key={row.label} label={row.label}>
              <div className="text-sm">{row.value}</div>
            </SettingRow>
          ))
        ) : (
          (await getRuntimeSettingsCardProps(canEdit)).settings
            .filter((setting) => setting.group === section.slug)
            .map((setting) => <RuntimeSettingRow canEdit={canEdit} key={setting.key} setting={setting} />)
        )}
      </SettingsSection>
    </div>
  );
}

async function LimitRows({ canEdit }: { canEdit: boolean }) {
  if (!isDatabaseConfigured()) return <EmptyLimits />;
  const [limits, tools] = await Promise.all([
    db.select().from(systemLimitsTable).orderBy(asc(systemLimitsTable.key)),
    db
      .select({ toolId: managedToolsTable.toolId, name: managedToolsTable.name, spec: managedToolsTable.spec })
      .from(managedToolsTable),
  ]);
  const editable = limits.filter((limit) => DATABASE_SYSTEM_LIMITS.includes(limit.key));
  if (!editable.length) return <EmptyLimits />;
  const overLimit = toolsOverLimits(tools, Object.fromEntries(limits.map((limit) => [limit.key, limit.value])));

  return editable.map((limit) => (
    <SettingRow
      description={limit.description}
      details={
        <>
          <Caption className="mt-1 block text-muted-foreground">
            Current {formatLimit(limit.value, limit.unit as LimitUnit)} · key <InlineCode>{limit.key}</InlineCode>
          </Caption>
          {overLimit[limit.key]?.length ? (
            <Caption className="mt-1 block text-muted-foreground">
              Capped at run time for:{" "}
              {overLimit[limit.key]!.map((tool, index) => (
                <span key={tool.toolId}>
                  {index ? ", " : null}
                  <Link className="underline" href={`/admin/tools/${tool.toolId}`}>
                    {tool.name}
                  </Link>
                </span>
              ))}
            </Caption>
          ) : null}
        </>
      }
      id={`limit-${limit.key}`}
      key={limit.key}
      label={limitLabel(limit.key)}
    >
      <SystemLimitForm
        canEdit={canEdit}
        id={`limit-${limit.key}`}
        limitKey={limit.key}
        unit={limit.unit as LimitUnit}
        updatedAt={limit.updatedAt.toISOString()}
        value={limit.value}
      />
    </SettingRow>
  ));
}

function EmptyLimits() {
  return (
    <li className="px-5 py-4">
      <P className="text-muted-foreground">
        No system limits are stored. Run the <InlineCode>0009-tool-spec</InlineCode> migration.
      </P>
    </li>
  );
}
