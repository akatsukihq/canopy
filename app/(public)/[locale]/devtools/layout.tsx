import { getTranslations } from "next-intl/server";
import type { Metadata, Viewport } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalog");
  return {
    title: { default: t("developerMetadataTitle") + " | SmartTools", template: "%s | SmartTools" },
    description: t("developerMetadataDescription"),
  };
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f8fafc",
};

export default function DevtoolsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
