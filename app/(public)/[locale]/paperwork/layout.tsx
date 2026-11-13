import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CatalogPage");
  return {
    title: { default: t("paperworkMetadataTitle") + " | SmartTools", template: "%s | SmartTools" },
    description: t("paperworkMetadataDescription"),
  };
}

export default function PaperworkLayout({ children }: { children: React.ReactNode }) {
  return <div className="paperwork-shell min-h-screen">{children}</div>;
}
