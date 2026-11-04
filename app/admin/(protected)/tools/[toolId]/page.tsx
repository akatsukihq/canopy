import { appHref } from "@/lib/routing/subdomains.ts";
import config from "@/lib/config/config.ts";
import { db, eq, managedToolsTable, getToolContentRow, isDatabaseConfigured, type ToolContentRow } from "@/db/index.ts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  BackButton,
  Button,
  Caption,
  H1,
  Overline,
  StatusBadge,
  Toaster,
} from "@/components/ui/index.tsx";
import { ExternalLink, FileText, Braces, Languages, LayoutDashboard, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "../../../../../lib/admin/access";
import { iconUploadsConfigured, toolTranslationSource } from "../../../../../lib/admin/adminMutations";
import { getAdminTools } from "../../../../../lib/tool-framework/manifest";
import { ToolContentForm } from "./components/ToolContentForm";
import { ActivationPanel, ToolIdentifier } from "./components/ToolConfigurationPanels";
import { DeveloperHandoff } from "../components/DeveloperHandoff";
import { ToolIconPanel } from "./components/ToolIconPanel";
import { inheritedContent } from "./toolSpec";
import { loadSpec } from "@/lib/tool-framework/catalog";
import { ToolTranslationsForm } from "./components/ToolTranslationsForm";
import { ToolDefinitionEditor } from "./components/ToolDefinitionEditor";

type ConfigurationSection = "overview" | "content" | "translations" | "definition";

const SECTIONS: readonly {
  readonly key: ConfigurationSection;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "content", label: "Content document", icon: FileText },
  { key: "translations", label: "Translations", icon: Languages },
  { key: "definition", label: "Definition", icon: Braces },
];

function selectedSection(value: string | string[] | undefined): ConfigurationSection {
  const section = Array.isArray(value) ? value[0] : value;
  return SECTIONS.some((candidate) => candidate.key === section) ? (section as ConfigurationSection) : "overview";
}

function publishedAtLabel(row: ToolContentRow | null): string | null {
  if (!row?.publishedAt) return null;
  return `${row.publishedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function ToolContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ toolId: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  await requirePagePermission("tools", "view");
  const toolId = decodeURIComponent((await params).toolId);
  const section = selectedSection((await searchParams).section);

  const tools = await getAdminTools();
  const tool = tools.find((candidate) => candidate.id === toolId);
  if (!tool) notFound();

  const configured = isDatabaseConfigured();
  const [contentRow, spec]: [ToolContentRow | null, Awaited<ReturnType<typeof loadSpec>>] = await Promise.all([
    configured ? getToolContentRow(toolId) : Promise.resolve(null),
    loadSpec(toolId),
  ]);
  const [managedRow] =
    configured && (section === "translations" || section === "definition")
      ? await db.select().from(managedToolsTable).where(eq(managedToolsTable.toolId, toolId)).limit(1)
      : [];
  const inherited = inheritedContent(spec, tool.name, tool.description);
  const inheritedView = {
    category: inherited.category,
    keywords: inherited.keywords,
    seoTitle: inherited.seoTitle,
    seoDescription: inherited.seoDescription,
    contentDoc: inherited.content,
  };
  const stored = {
    category: contentRow?.category ?? null,
    keywords: contentRow?.keywords ?? null,
    seoTitle: contentRow?.seoTitle ?? null,
    seoDescription: contentRow?.seoDescription ?? null,
    contentDoc: contentRow?.contentDoc ?? null,
    published: Boolean(contentRow?.publishedAt),
    publishedAtLabel: publishedAtLabel(contentRow),
    hasRow: contentRow !== null,
  };
  const publicHref = tool.slug ? new URL(`/${tool.app}/${tool.slug}`, config.appUrl).href : null;
  const definitionKey = tool.id.split(".").slice(1).join(".");
  const scaffoldCommand = `pnpm tool:new ${definitionKey} --app ${tool.app} --category ${(contentRow?.category ?? inherited.category) || "<category>"}`;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1240px] flex-col gap-3">
      <Toaster position="top-right" />
      <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <BackButton href={appHref("/admin/tools")} label="Back to tool catalog" />
          <div className="min-w-0">
            <H1>{tool.name}</H1>
            <Caption className="mt-1 block break-words text-muted-foreground">
              {tool.app} / {tool.slug ?? "No public URL assigned"}
            </Caption>
          </div>
        </div>
        {tool.enabled && publicHref ? (
          <Button asChild className="w-fit shrink-0" variant="secondary">
            <a href={publicHref} rel="noreferrer" target="_blank">
              Open public tool <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </header>

      <nav aria-label="Tool configuration sections" className="shrink-0 overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-1">
          {SECTIONS.map(({ icon: Icon, key, label }) => (
            <Link
              aria-current={section === key ? "page" : undefined}
              className={`relative inline-flex min-h-10 items-center gap-2 px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${section === key ? "text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}
              href={appHref(`/admin/tools/${encodeURIComponent(tool.id)}?section=${key}`)}
              key={key}
              scroll={false}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-5">
        {section === "overview" ? (
          <div className="grid min-h-0 flex-1 content-start items-start gap-6 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-8">
            <div className="min-w-0">
              <ToolContentForm
                inherited={inheritedView}
                relatedTools={[]}
                section="catalog"
                stored={stored}
                toolId={tool.id}
              />
              <Accordion className="mt-5 border-t border-border" collapsible type="single">
                <AccordionItem value="technical-details">
                  <AccordionTrigger>Technical details</AccordionTrigger>
                  <AccordionContent className="space-y-5">
                    <div className="flex flex-wrap items-start gap-x-12 gap-y-4">
                      <ToolIdentifier toolId={tool.id} />
                      <div>
                        <Overline className="mb-1 block text-muted-foreground">Code definition</Overline>
                        <StatusBadge variant={spec ? "success" : "warning"}>
                          {spec ? "Deployed" : "Missing"}
                        </StatusBadge>
                      </div>
                    </div>
                    {!spec ? <DeveloperHandoff command={scaffoldCommand} /> : null}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <aside className="min-w-0 border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
              <ActivationPanel
                enabled={tool.enabled}
                hasDefinition={tool.hasDefinition}
                hasDraftContent={tool.hasDraftContent}
                published={stored.published}
                publishedAtLabel={stored.publishedAtLabel}
                publicHref={publicHref}
                toolId={tool.id}
              />
              <div className="mt-3 border-t border-border pt-3">
                <ToolIconPanel
                  iconUrl={tool.iconUrl}
                  name={tool.name}
                  toolId={tool.id}
                  uploadsEnabled={iconUploadsConfigured()}
                />
              </div>
            </aside>
          </div>
        ) : null}

        {section === "content" ? (
          <ToolContentForm
            inherited={inheritedView}
            relatedTools={tools
              .filter((candidate) => candidate.id !== tool.id)
              .map((candidate) => ({ id: candidate.id, name: candidate.name }))}
            section="content"
            stored={stored}
            toolId={tool.id}
          />
        ) : null}

        {section === "translations" && managedRow ? (
          <ToolTranslationsForm
            enabled={managedRow.enabled}
            englishMessages={Object.fromEntries(
              Object.entries(toolTranslationSource(spec, managedRow, contentRow)).map(([key, source]) => [
                key,
                managedRow.translations.en?.messages[key] ?? source,
              ]),
            )}
            toolId={tool.id}
            translations={managedRow.translations}
            updatedAt={managedRow.updatedAt.toISOString()}
          />
        ) : null}

        {section === "definition" && managedRow && tool.app !== "paperwork" ? (
          <ToolDefinitionEditor
            app={tool.app}
            hasDraft={tool.hasSpecDraft}
            initialJson={JSON.stringify(tool.specDraft ?? tool.rawSpec ?? {}, null, 2)}
            publishedJson={JSON.stringify(tool.rawSpec ?? {}, null, 2)}
            toolId={tool.id}
            updatedAt={managedRow.updatedAt.toISOString()}
          />
        ) : null}
      </main>
    </div>
  );
}
