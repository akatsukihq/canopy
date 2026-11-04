import { NextIntlClientProvider } from "next-intl";
import { isLocale } from "@/lib/i18n/config";
import { getCommonMessages } from "@/lib/i18n/messages";
import { toolMessageTree } from "@/lib/tool-framework/translations";
import { getOptionalSession } from "@/lib/auth/session.ts";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ToolPage from "@/components/ToolPage";
import { IMAGE_CONVERSION_KEYS } from "@/app/media/lib/imageConversion";
import { loadSpecByDefinitionKey, relatedTools, resolveToolPage } from "@/lib/tool-framework/catalog";
import type { ToolSpec } from "@/lib/tool-framework/spec";
import { toolMetadata } from "@/lib/tool-framework/metadata";

// Deliberately no `generateStaticParams`: slugs and enablement live in
// `managed_tools` and an admin toggles them at runtime, so prerendering would
// need a redeploy per admin change.
export const generateMetadata = toolMetadata("media");

export default async function MediaToolPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  if (!isLocale(locale)) notFound();
  const tool = await resolveToolPage("media", slug, locale);
  if (!tool) notFound();

  const [related, session, conversions] = await Promise.all([
    relatedTools(tool.toolId, locale),
    getOptionalSession(await headers()),
    IMAGE_CONVERSION_KEYS.includes(tool.definitionKey)
      ? Promise.all(IMAGE_CONVERSION_KEYS.map(loadSpecByDefinitionKey))
      : Promise.resolve([]),
  ]);

  return (
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
        conversions={conversions.filter((entry): entry is ToolSpec => entry !== null)}
        definitionKey={tool.definitionKey}
        description={tool.description}
        icon={tool.icon}
        relatedTools={related.map((candidate) => ({
          href: candidate.href,
          label: candidate.name,
        }))}
        spec={tool.spec}
        title={tool.name}
      />
    </NextIntlClientProvider>
  );
}
