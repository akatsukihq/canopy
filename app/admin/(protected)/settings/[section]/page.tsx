import Link from "next/link";
import { notFound } from "next/navigation";
import { Caption } from "@/components/ui/index.tsx";
import { asc, db, isDatabaseConfigured, managedToolsTable, systemLimitsTable } from "@/db/index.ts";
import { requirePagePermission } from "@/lib/admin/access";
import { getUserAuthorization } from "@/lib/admin/index.ts";
import { getRuntimeSettingsCardProps, type RuntimeSettingView } from "@/lib/admin/runtimeSettings.ts";
import { hasPermission } from "@/lib/authorization/index.ts";
import { DATABASE_SYSTEM_LIMITS } from "@/lib/tool-framework/systemLimits";
import { SettingsForm, type SettingField, type SettingGroup } from "../components/SettingsForm";
import { MIB, type LimitUnit } from "../lib/limitUnits";
import { toolsOverLimits } from "../lib/overLimitTools";
import { limitLabel, SETTINGS_SECTIONS } from "../lib/sections";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<LimitUnit, string> = { bytes: "MiB", chars: "characters", count: "", px: "px" };

async function limitFields(): Promise<Map<string, SettingField>> {
  if (!isDatabaseConfigured()) return new Map();
  const [limits, tools] = await Promise.all([
    db.select().from(systemLimitsTable).orderBy(asc(systemLimitsTable.key)),
    db
      .select({ toolId: managedToolsTable.toolId, name: managedToolsTable.name, spec: managedToolsTable.spec })
      .from(managedToolsTable),
  ]);
  const overLimit = toolsOverLimits(tools, Object.fromEntries(limits.map((limit) => [limit.key, limit.value])));
  return new Map(
    limits
      .filter((limit) => DATABASE_SYSTEM_LIMITS.includes(limit.key))
      .map((limit) => {
        const unit = limit.unit as LimitUnit;
        const scale = unit === "bytes" ? MIB : 1;
        const capped = overLimit[limit.key] ?? [];
        return [
          limit.key,
          {
            key: limit.key,
            store: "limit",
            kind: "number",
            label: limitLabel(limit.key),
            description: limit.description,
            value: String(limit.value / scale),
            scale,
            unit: UNIT_LABEL[unit] || undefined,
            updatedAt: limit.updatedAt.toISOString(),
            details: capped.length ? (
              <Caption className="mt-1 block text-muted-foreground">
                Capped at run time for:{" "}
                {capped.map((tool, index) => (
                  <span key={tool.toolId}>
                    {index ? ", " : null}
                    <Link className="underline" href={`/admin/tools/${tool.toolId}`}>
                      {tool.name}
                    </Link>
                  </span>
                ))}
              </Caption>
            ) : null,
          } satisfies SettingField,
        ] as const;
      }),
  );
}

function runtimeField(setting: RuntimeSettingView): SettingField {
  return {
    key: setting.key,
    store: "runtime",
    kind: setting.kind,
    label: setting.label,
    description: setting.description,
    value: String(setting.value),
    unit: setting.unit,
    options: setting.options,
    overridden: setting.source === "admin",
    defaultValue: String(setting.envValue),
  };
}

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const session = await requirePagePermission("settings", "view");
  const slug = (await params).section;
  const section = SETTINGS_SECTIONS.find((entry) => entry.slug === slug);
  if (!section) notFound();

  const { access } = await getUserAuthorization(session.user.id);
  const canEdit = hasPermission(access, "settings", "edit");
  const fields =
    section.slug === "limits"
      ? await limitFields()
      : new Map(
          (await getRuntimeSettingsCardProps(canEdit)).settings.map((setting) => [setting.key, runtimeField(setting)]),
        );
  const groups: SettingGroup[] = section.groups
    .map((group) => ({
      title: group.title,
      description: group.description,
      fields: group.keys.flatMap((key) => fields.get(key) ?? []),
    }))
    .filter((group) => group.fields.length);
  // Remount the form after a save so drafts restart from the stored values.
  const version = groups
    .flatMap((group) =>
      group.fields.map((field) => `${field.key}=${field.value}@${field.updatedAt ?? field.overridden}`),
    )
    .join("|");

  return (
    <SettingsForm
      canEdit={canEdit}
      description={
        groups.length
          ? section.description
          : `${section.description} No settings are stored yet; run the database migrations.`
      }
      groups={groups}
      key={version}
      title={section.label}
    />
  );
}
