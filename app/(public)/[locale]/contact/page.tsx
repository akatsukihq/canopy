import { loadRuntimeSettings } from "@/lib/config/runtimeSettings.ts";
import { Display, Muted, Overline, Strong, Text, TextLink } from "@/components/ui/index.tsx";
import type { Metadata } from "next";
import { Clock3, LifeBuoy, Mail } from "lucide-react";
import PublicInfoChrome from "@/components/canopy/PublicInfoChrome";
import ContactForm from "@/app/contact/ContactForm";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale, localizeHref } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Contact");
  return { title: t("metadataTitle"), description: t("metadataDescription") };
}

const methods = [
  { key: "email", icon: Mail },
  { key: "help", icon: LifeBuoy },
  { key: "response", icon: Clock3 },
] as const;

export default async function ContactPage() {
  const t = await getTranslations("Contact");
  const requestedLocale = await getLocale();
  const locale = isLocale(requestedLocale) ? requestedLocale : "en";
  const supportEmail = String((await loadRuntimeSettings())["site.supportEmail"].value);

  return (
    <PublicInfoChrome>
      <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-6 py-16 lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-[72px] lg:px-[150px] lg:py-20">
        <section className="flex flex-col gap-6">
          <header>
            <Overline className="block text-primary">{t("eyebrow")}</Overline>
            <Display className="mt-2">{t("heading")}</Display>
            <Muted className="mt-3 text-muted-foreground">{t("description")}</Muted>
          </header>

          <div className="flex flex-col gap-3.5">
            {methods.map(({ key, icon: Icon }) => {
              const title = t(`${key}Title`);
              const detail = key === "email" ? supportEmail || t("emailUnavailable") : t(`${key}Description`);
              const content = (
                <>
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent text-primary group-hover:text-accent-foreground">
                    <Icon aria-hidden="true" className="size-[22px]" />
                  </span>
                  <span>
                    <Strong className="block">{title}</Strong>
                    <Text
                      className="mt-0.5 block text-muted-foreground group-hover:text-accent-foreground"
                      dir={key === "email" && supportEmail ? "ltr" : undefined}
                    >
                      {detail}
                    </Text>
                  </span>
                </>
              );

              const destination =
                key === "email" && supportEmail
                  ? `mailto:${supportEmail}`
                  : key === "help"
                    ? localizeHref("/#tools", locale)
                    : undefined;
              return destination ? (
                <TextLink
                  className="group no-underline text-foreground flex items-center gap-3.5 rounded-lg bg-muted p-4 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  href={destination}
                  key={key}
                >
                  {content}
                </TextLink>
              ) : (
                <div className="flex items-center gap-3.5 rounded-lg bg-muted p-4" key={key}>
                  {content}
                </div>
              );
            })}
          </div>
        </section>

        <ContactForm supportEmail={supportEmail} />
      </div>
    </PublicInfoChrome>
  );
}
