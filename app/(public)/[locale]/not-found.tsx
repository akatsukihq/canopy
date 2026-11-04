"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { Button, ErrorPage } from "@/components/ui/index.tsx";
import { defaultLocale, isLocale, localizeHref } from "@/lib/i18n/config";

export default function PublicNotFound() {
  const t = useTranslations("Common");
  const requestedLocale = useLocale();
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const pathname = usePathname();

  return (
    <ErrorPage
      kind="not-found"
      title={t("unavailableTitle")}
      description={t("unavailableDescription")}
      homeHref={localizeHref("/", locale)}
      action={
        <div>
          {locale !== defaultLocale && (
            <Button asChild>
              <a href={localizeHref(pathname, defaultLocale)}>{t("tryEnglish")}</a>
            </Button>
          )}
          <Button asChild variant="outline">
            <a href={localizeHref("/", locale)}>{t("explore")}</a>
          </Button>
        </div>
      }
    />
  );
}
