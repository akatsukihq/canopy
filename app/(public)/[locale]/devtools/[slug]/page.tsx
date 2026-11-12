import { NextIntlClientProvider } from "next-intl";
import { isLocale } from "@/lib/i18n/config";
import { getCommonMessages } from "@/lib/i18n/messages";
import { toolMessageTree } from "@/lib/tool-framework/translations";
import { getOptionalSession } from "@/lib/auth/session.ts";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ToolPage from "@/components/ToolPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { toolStructuredData } from "@/lib/seo/structuredData";
import { getTranslations } from "next-intl/server";
import { relatedTools, resolveToolPage } from "@/lib/tool-framework/catalog";
import { toolMetadata } from "@/lib/tool-framework/metadata";
import { loadRuntimeLimits } from "@/lib/tool-framework/systemLimits";

// Deliberately no `generateStaticParams`: slugs and enablement live in
// `managed_tools` and an admin toggles them at runtime, so prerendering would
// need a redeploy per admin change.
export const generateMetadata = toolMetadata("devtools");

export default async function DevtoolsToolPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  if (!isLocale(locale)) notFound();
  const tool = await resolveToolPage("devtools", slug, locale);
  if (!tool) notFound();

  const [catalog, related, session, limits] = await Promise.all([
    getTranslations({ locale, namespace: "Catalog" }),
    relatedTools(tool.toolId, locale),
    getOptionalSession(await headers()),
    loadRuntimeLimits(),
  ]);

  return (
    <>
      <JsonLd
        data={toolStructuredData({
          suite: "devtools",
          suiteName: catalog("developerOverline"),
          name: tool.name,
          description: tool.seoDescription,
          href: tool.href,
          locale,
        })}
      />
      <NextIntlClientProvider
        locale={locale}
        messages={{ ...getCommonMessages(locale), Tool: toolMessageTree(tool.messages) }}
      >
        <ToolPage
          availableLocales={tool.availableLocales}
          account={{
            returnTo: tool.href,
            user: session?.user ?? null,
          }}
          category={getCommonMessages(locale).Categories[tool.category]}
          definitionKey={tool.definitionKey}
          description={tool.description}
          icon={tool.icon}
          limits={limits}
          relatedTools={related.map((candidate) => ({
            href: candidate.href,
            label: candidate.name,
          }))}
          spec={tool.spec}
          title={tool.name}
        />
      </NextIntlClientProvider>
    </>
  );
}
