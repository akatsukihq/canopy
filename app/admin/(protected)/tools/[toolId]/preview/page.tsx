import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import ToolPage from "@/components/ToolPage";
import { AlertBanner, Button } from "@/components/ui/index.tsx";
import { IMAGE_CONVERSION_KEYS } from "@/app/media/lib/imageConversion";
import { db, eq, managedToolsTable, isDatabaseConfigured } from "@/db/index.ts";
import { getCommonMessages } from "@/lib/i18n/messages";
import { appHref } from "@/lib/routing/subdomains.ts";
import { definitionKeyOf, loadSpecByDefinitionKey } from "@/lib/tool-framework/catalog";
import { resolveContent } from "@/lib/tool-framework/content";
import { resolveIcon } from "@/lib/tool-framework/icons";
import type { ToolSpec } from "@/lib/tool-framework/spec";
import { parseToolSpec } from "@/lib/tool-framework/specSchema";
import { clampSpecLimits, loadRuntimeLimits, loadSystemLimits } from "@/lib/tool-framework/systemLimits";
import { applyToolMessages, extractToolMessages, toolMessageTree } from "@/lib/tool-framework/translations";
import { requirePagePermission } from "../../../../../../lib/admin/access";

// Admin-only, uncached, never indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tool preview", robots: { index: false, follow: false } };

const TOOL_ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/;

function Banner({
  text,
  editorHref,
  variant,
}: {
  text: string;
  editorHref: string;
  variant: "info" | "warning" | "error";
}) {
  return (
    <AlertBanner
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={editorHref}>Back to tool admin</Link>
        </Button>
      }
      className="rounded-none"
      variant={variant}
    >
      {text}
    </AlertBanner>
  );
}

export default async function ToolSpecPreviewPage({ params }: { params: Promise<{ toolId: string }> }) {
  await requirePagePermission("tools", "view");
  const toolId = decodeURIComponent((await params).toolId);
  if (!TOOL_ID_PATTERN.test(toolId) || !isDatabaseConfigured()) notFound();

  const [row] = await db.select().from(managedToolsTable).where(eq(managedToolsTable.toolId, toolId)).limit(1);
  if (!row) notFound();

  const editorHref = appHref(`/admin/tools/${encodeURIComponent(toolId)}`);
  const draft = row.specDraft ?? null;
  const parsed = parseToolSpec(draft ?? row.spec);
  const issues = parsed.ok
    ? parsed.spec.toolId !== row.toolId || parsed.spec.app !== row.app
      ? ["toolId/app: does not match this tool"]
      : []
    : parsed.issues;

  if (!parsed.ok || issues.length) {
    return (
      <div>
        <Banner editorHref={editorHref} text="Preview unavailable — the spec is invalid" variant="error" />
        <ul className="list-disc space-y-1 p-6 pl-10 text-sm">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </div>
    );
  }

  const spec = clampSpecLimits(parsed.spec, await loadSystemLimits());
  const resolved = resolveContent(spec, null);
  const sourceSpec: ToolSpec = {
    ...spec,
    category: resolved.category,
    keywords: resolved.keywords,
    content: resolved.content,
  };
  const messages = extractToolMessages(sourceSpec, resolved);
  const localized = { ...applyToolMessages(sourceSpec, messages, "en"), messages: undefined };
  const definitionKey = definitionKeyOf(toolId) ?? "";
  const conversions = IMAGE_CONVERSION_KEYS.includes(definitionKey)
    ? (await Promise.all(IMAGE_CONVERSION_KEYS.map(loadSpecByDefinitionKey))).filter(
        (entry): entry is ToolSpec => entry !== null,
      )
    : [];

  return (
    <div>
      <Banner
        editorHref={editorHref}
        variant={draft ? "warning" : "info"}
        text={
          draft ? "Preview of the unpublished draft — not visible to visitors" : "No draft — showing the published spec"
        }
      />
      <NextIntlClientProvider locale="en" messages={{ ...getCommonMessages("en"), Tool: toolMessageTree(messages) }}>
        <ToolPage
          account={{ returnTo: editorHref, user: null }}
          category={getCommonMessages("en").Categories[resolved.category]}
          conversions={conversions}
          definitionKey={definitionKey}
          description={localized.description}
          icon={resolveIcon(row.toolId, localized.name, row.icon)}
          limits={await loadRuntimeLimits()}
          relatedTools={[]}
          spec={localized}
          title={localized.name}
        />
      </NextIntlClientProvider>
    </div>
  );
}
