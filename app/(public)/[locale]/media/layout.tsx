import { getTranslations } from "next-intl/server";
import type { Metadata, Viewport } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Catalog");
  return {
    title: { default: t("mediaMetadataTitle") + " | SmartTools", template: "%s | SmartTools" },
    description: t("mediaMetadataDescription"),
  };
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f8fafc",
};

export default function MediaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="media-shell min-h-screen">{children}</div>;
}
