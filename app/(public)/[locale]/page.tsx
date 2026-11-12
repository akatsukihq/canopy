import { getLocale, getTranslations } from "next-intl/server";
import { localizeHref, localizedAlternates, type Locale } from "@/lib/i18n/config";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteStructuredData } from "@/lib/seo/structuredData";
import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { getOptionalSession } from "@/lib/auth/session.ts";
import {
  Caption,
  Display,
  H2,
  H3,
  List,
  Metric,
  Muted,
  Overline,
  P,
  Text,
  TextLink,
  AccountNavigation,
  Button,
  ProductHeader,
} from "@/components/ui/index.tsx";
import { headers } from "next/headers";
import type { Metadata, ResolvingMetadata } from "next";

// A page-level `openGraph` replaces the inherited one, so carry the segment's image forward.
export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const [t, locale, inherited] = await Promise.all([getTranslations("Home"), getLocale(), parent]);
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
    alternates: localizedAlternates("/", locale as Locale),
    openGraph: {
      title: t("metadataTitle"),
      description: t("metadataDescription"),
      type: "website",
      siteName: "SmartTools",
      images: inherited.openGraph?.images,
    },
  };
}

const projects = [
  {
    number: "01",
    category: "documentsCategory",
    name: "Paperwork",
    description: "documentsDescription",
    href: "/paperwork",
  },
  {
    number: "02",
    category: "developerCategory",
    name: "Devtools",
    description: "developerDescription",
    href: "/devtools",
  },
  {
    number: "03",
    category: "mediaCategory",
    name: "Media Tools",
    description: "mediaDescription",
    href: "/media",
  },
] as const;

export default async function HomePage() {
  const t = await getTranslations("Home");
  const locale = (await getLocale()) as Locale;
  const session = await getOptionalSession(await headers());

  return (
    <div className="platform-shell min-h-screen bg-background text-foreground">
      <ProductHeader
        account={{ returnTo: "/", user: session?.user ?? null }}
        actions={<AccountNavigation returnTo="/" user={session?.user ?? null} />}
        className="platform-header sticky top-0 z-50"
        href="/"
        name="SmartTools"
      />

      <main>
        <JsonLd data={siteStructuredData({ description: t("metadataDescription"), locale })} />
        <section className="overflow-hidden border-b border-border bg-card">
          <div className="mx-auto grid max-w-7xl lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,0.92fr)]">
            <div className="flex min-h-[36rem] flex-col justify-center px-4 py-16 sm:px-6 sm:py-20 lg:min-h-[44rem] lg:border-e lg:border-border lg:px-8 lg:py-24">
              <Overline className="block mb-6 text-primary">{t("eyebrow")}</Overline>
              <Display className="max-w-4xl">
                {t.rich("heroTitle", { accent: (chunks) => <span className="text-primary">{chunks}</span> })}
              </Display>
              <Muted className="mt-8 max-w-xl text-muted-foreground">{t("intro")}</Muted>
              <div className="mt-9 flex flex-wrap gap-3">
                <Button asChild className="h-auto min-h-12 rounded-none px-5 hover:bg-foreground">
                  <a href={localizeHref(projects[0].href, locale)}>{t("explorePaperwork")}</a>
                </Button>
                <Button
                  asChild
                  className="h-auto min-h-12 rounded-none border-foreground px-5 hover:bg-foreground hover:text-card"
                  variant="outline"
                >
                  <a href={localizeHref(projects[1].href, locale)}>{t("browseDevtools")}</a>
                </Button>
                <Button
                  asChild
                  className="h-auto min-h-12 rounded-none border-foreground px-5 hover:bg-foreground hover:text-card"
                  variant="outline"
                >
                  <a href={localizeHref(projects[2].href, locale)}>{t("openMedia")}</a>
                </Button>
              </div>
              <Caption className="block mt-6 text-muted-foreground">{t("noAccount")}</Caption>
            </div>

            <nav
              aria-labelledby="suite-navigation-title"
              className="platform-grid flex flex-col justify-center bg-background px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
            >
              <H2 className="mb-4" id="suite-navigation-title">
                {t("chooseSuite")}
              </H2>
              <List className="list-none p-0 space-y-0 border border-border bg-card">
                {projects.map((project) => (
                  <li className="border-b border-border last:border-b-0" key={project.name}>
                    <TextLink
                      className="no-underline group grid min-h-56 grid-cols-[5rem_minmax(0,1fr)] text-foreground outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
                      href={localizeHref(project.href, locale)}
                    >
                      <span
                        aria-hidden="true"
                        className="flex items-start justify-center border-e border-border px-3 py-6 text-primary transition-colors group-hover:border-white/35 group-hover:text-primary-foreground"
                      >
                        <Metric>{project.number}</Metric>
                      </span>
                      <div className="flex min-w-0 flex-col p-6">
                        <Overline className="text-muted-foreground transition-colors group-hover:text-white/70">
                          {t(project.category)}
                        </Overline>
                        <H3 className="mt-3">{project.name}</H3>
                        <Text className="mt-4 max-w-sm text-muted-foreground transition-colors group-hover:text-white/80">
                          {t(project.description)}
                        </Text>
                        <Text className="mt-auto pt-6 underline decoration-1 underline-offset-4">
                          {t("openSuite", { name: project.name })}
                        </Text>
                      </div>
                    </TextLink>
                  </li>
                ))}
              </List>
            </nav>
          </div>
        </section>

        <section aria-labelledby="projects-title" className="border-b border-border">
          <div className="mx-auto grid max-w-7xl lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
            <div className="border-b border-border px-4 py-12 sm:px-6 lg:border-e lg:border-b-0 lg:px-8 lg:py-20">
              <Overline className="block text-primary">{t("capabilitiesEyebrow")}</Overline>
              <H2 className="mt-5 max-w-md" id="projects-title">
                {t("capabilitiesTitle")}
              </H2>
            </div>

            <div className="grid sm:grid-cols-3">
              <article className="border-b border-border p-6 sm:border-e sm:border-b-0 lg:p-8">
                <P aria-hidden="true" className="text-primary">
                  01
                </P>
                <H3 className="mt-10">{t("documentTitle")}</H3>
                <Muted className="mt-3 text-muted-foreground">{t("documentsDescription")}</Muted>
              </article>
              <article className="border-b border-border p-6 sm:border-e sm:border-b-0 lg:p-8">
                <P aria-hidden="true" className="text-primary">
                  02
                </P>
                <H3 className="mt-10">{t("mediaTitle")}</H3>
                <Muted className="mt-3 text-muted-foreground">{t("mediaDescription")}</Muted>
              </article>
              <article className="p-6 lg:p-8">
                <P aria-hidden="true" className="text-primary">
                  03
                </P>
                <H3 className="mt-10">{t("dataTitle")}</H3>
                <Muted className="mt-3 text-muted-foreground">{t("developerDescription")}</Muted>
              </article>
            </div>
          </div>
        </section>
      </main>

      <CanopyFooter />
    </div>
  );
}
