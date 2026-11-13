import { getLocale, getTranslations } from "next-intl/server";
import { isLocale, defaultLocale, localizedAlternates } from "@/lib/i18n/config";
import { JsonLd } from "@/components/seo/JsonLd";
import { suiteStructuredData } from "@/lib/seo/structuredData";
import type { Metadata } from "next";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { getOptionalSession } from "@/lib/auth/session.ts";
import { definitionKeyOf, getPublicToolListings } from "@/lib/tool-framework/catalog";
import { AccountNavigation, CatalogCard, H2, PageHero, ProductHeader, StatusBadge } from "@/components/ui/index.tsx";
import {
  ClipboardCheck,
  ClipboardList,
  Compass,
  DollarSign,
  FileText,
  ReceiptText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { headers } from "next/headers";

const TOOL_ICONS: Record<string, LucideIcon> = {
  "invoice-generator": FileText,
  "receipt-generator": ReceiptText,
  "expense-report": ClipboardCheck,
  "mileage-log": Compass,
  "quarterly-tax-estimator": DollarSign,
  "w9-request": ClipboardList,
  "1099-nec-tracker": Sparkles,
};

export async function generateMetadata(): Promise<Metadata> {
  const requestedLocale = await getLocale();
  return { alternates: localizedAlternates("/paperwork", isLocale(requestedLocale) ? requestedLocale : defaultLocale) };
}

export default async function HomePage() {
  const [requestedLocale, t, common] = await Promise.all([
    getLocale(),
    getTranslations("CatalogPage"),
    getTranslations("Common"),
  ]);
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const requestHeaders = await headers();
  const [tools, session] = await Promise.all([
    getPublicToolListings(locale, "paperwork"),
    getOptionalSession(requestHeaders),
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProductHeader
        account={{ returnTo: "/paperwork", user: session?.user ?? null }}
        actions={<AccountNavigation returnTo="/paperwork" user={session?.user ?? null} />}
        href="/paperwork"
        name="Paperwork"
      />
      <main>
        <JsonLd
          data={suiteStructuredData({
            suite: "paperwork",
            name: "Paperwork",
            description: t("paperworkDescription"),
            locale,
            tools: tools.map((tool) => ({ name: tool.name, href: tool.href })),
          })}
        />
        <PageHero
          compact
          description={t("paperworkDescription")}
          eyebrow={t("paperworkEyebrow")}
          title={t("paperworkTitle")}
        />

        <section aria-labelledby="paperwork-tools-title" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <H2 className="mb-4" id="paperwork-tools-title">
            {common("allTools")}
          </H2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => {
              const Icon = TOOL_ICONS[definitionKeyOf(tool.toolId) ?? ""] ?? FileText;

              return (
                <CatalogCard
                  action={<>{t("openTool")} →</>}
                  description={tool.description}
                  href={tool.href}
                  icon={<Icon aria-hidden="true" className="size-5" />}
                  key={tool.toolId}
                  status={<StatusBadge variant="success">{t("available")}</StatusBadge>}
                  title={tool.name}
                />
              );
            })}
          </div>
        </section>
      </main>
      <CanopyFooter />
    </div>
  );
}
