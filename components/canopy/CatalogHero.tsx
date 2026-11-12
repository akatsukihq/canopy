import Image from "next/image";
import { useTranslations } from "next-intl";
import { AppContainer, Caption, Display, Lead, Overline } from "@/components/ui/index.tsx";

export function CatalogHero({ suite }: { suite: "media" | "devtools" }) {
  const t = useTranslations("Catalog");
  const isMedia = suite === "media";
  return (
    <section className="bg-muted/50">
      <AppContainer className="grid items-center gap-6 px-6 py-8 sm:px-8 md:grid-cols-2 md:gap-8 lg:px-16">
        <div className="min-w-0 text-start max-md:text-center">
          {/* The suite name opens the heading so the page's H1 names what it offers, not only the slogan. */}
          <Display className="text-[2.5rem] leading-[1.05] tracking-tight lg:text-[3.25rem]">
            <Overline className="mb-3 block text-primary">
              {t(isMedia ? "mediaOverline" : "developerOverline")}
            </Overline>{" "}
            {t(isMedia ? "mediaTitle" : "developerTitle")}{" "}
            <span className={`mt-3 block text-primary ${isMedia ? "" : "max-md:mt-0 max-md:inline"}`}>
              {t("onYourTerms")}
            </span>
          </Display>
          <Lead className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
            {t(isMedia ? "mediaDescription" : "developerDescription")}
            <br className="hidden lg:block" /> {t(isMedia ? "mediaSupport" : "developerSupport")}
          </Lead>
          <Caption className="mt-3 block text-muted-foreground">
            {t(isMedia ? "mediaPrivacy" : "developerPrivacy")}
          </Caption>
        </div>
        <Image
          alt=""
          className="mx-auto h-auto w-full max-w-[560px]"
          height={isMedia ? 1572 : 1617}
          loading="eager"
          sizes="(min-width: 1280px) 560px, (min-width: 768px) 46vw, 90vw"
          src={`/assets/${suite}-illustration@4x.png`}
          width={2428}
        />
      </AppContainer>
    </section>
  );
}
