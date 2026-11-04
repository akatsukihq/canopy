"use client";

import { CanopyFooter } from "@/components/canopy/CanopyFooter";
import { useLocale, useTranslations } from "next-intl";
import { defaultLocale, isLocale, localizeHref } from "@/lib/i18n/config";
import {
  InlineCode,
  Overline,
  Caption,
  Strong,
  Muted,
  List,
  H2,
  AccountNavigation,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  IconTile,
  ToolPageShell,
  WorkbenchShell,
} from "@/components/ui/index.tsx";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  Globe2,
  ListChecks,
  LockKeyhole,
  Undo2,
  Wrench,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

import { ToolRuntimeProvider, useToolRuntime } from "@/lib/tool-runtime/useToolRuntime";
import type { CategoryKey } from "@/lib/tool-framework/categories";
import type { ToolContent, ToolWorkbenchMark } from "@/lib/tool-framework/spec";
import type {
  ToolLifecycle,
  ToolDefinition,
  ToolPageComponentProps,
  ToolRuntimeSpec,
  ToolSettings,
} from "@/lib/tool-runtime/types";

type UniversalWorkbenchProps<Input, Settings extends ToolSettings, Result> = Omit<
  ToolPageComponentProps,
  "definitionKey"
> & {
  categoryKey: CategoryKey;
  content: ToolContent;
  definition: ToolDefinition;
  runtimeSpec: ToolRuntimeSpec<Input, Settings, Result>;
  StatusMeta?: ComponentType;
  completedStatus?: string;
  statusMeta?: ReactNode;
  validationReason?: string | null;
  Toolbar: ComponentType;
  workbenchIcon?: ReactNode;
  workbenchMark?: ToolWorkbenchMark;
  Workspace: ComponentType;
};

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Reactive `navigator.onLine`. Assumes online during SSR so the network dialog
// never flashes before hydration.
function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

// Shown for tools flagged `capabilities.network` while the browser is offline:
// they call a live service and cannot run without a connection.
function OfflineNoticeDialog({ toolName }: { toolName: string }) {
  const t = useTranslations("Workbench");
  const isOnline = useIsOnline();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isOnline) setDismissed(false);
  }, [isOnline]);

  return (
    <AlertDialog
      open={!isOnline && !dismissed}
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <AlertDialogContent className="max-w-md" data-testid="tool-offline-overlay">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("offlineTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("offlineDescription", { name: toolName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setDismissed(true)}>{t("gotIt")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmationDialog({
  changes,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: {
  changes: readonly string[];
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const t = useTranslations("Workbench");
  return (
    <AlertDialog open>
      <AlertDialogContent
        className="max-w-md border-amber-500/40"
        data-testid="tool-confirmation-overlay"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {changes.length > 0 ? (
          <List className="max-h-32 space-y-1 overflow-auto rounded-md bg-muted p-3">
            {changes.map((change) => (
              <li key={change}>
                <InlineCode>{change}</InlineCode>
              </li>
            ))}
          </List>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function WorkbenchFrame<Input, Settings extends ToolSettings, Result>({
  account,
  category,
  categoryKey,
  content,
  definition,
  description,
  relatedTools = [],
  StatusMeta,
  completedStatus,
  statusMeta,
  validationReason,
  title,
  Toolbar,
  workbenchIcon,
  workbenchMark,
  Workspace,
}: Omit<UniversalWorkbenchProps<Input, Settings, Result>, "runtimeSpec">) {
  const t = useTranslations("Workbench");
  const common = useTranslations("Common");
  const messages = useTranslations();
  const requestedLocale = useLocale();
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const runtime = useToolRuntime<Input, Settings, Result>();
  const workbenchMarkText = workbenchMark?.text.trim();
  const isBusy = runtime.lifecycle === "running";
  const factSummary = runtime.facts
    .map((fact) => {
      const labelKey = fact.labelMessage ? `Tool.runtime.${fact.labelMessage.key}` : undefined;
      const valueKey = fact.valueMessage ? `Tool.runtime.${fact.valueMessage.key}` : undefined;
      const label = labelKey && messages.has(labelKey) ? messages(labelKey, fact.labelMessage?.values) : fact.label;
      const value = valueKey && messages.has(valueKey) ? messages(valueKey, fact.valueMessage?.values) : fact.value;
      return `${label}: ${value}`;
    })
    .join(" · ");
  const status =
    runtime.lifecycle === "running"
      ? definition.labels.running
      : runtime.lifecycle === "completed"
        ? runtime.notice ||
          completedStatus ||
          [definition.labels.ready.replace(/[.!?]+$/, ""), factSummary].filter(Boolean).join(" · ")
        : runtime.notice ||
          runtime.error ||
          runtime.issues[0]?.message ||
          validationReason ||
          lifecycleLabel(definition, runtime.lifecycle, t);
  const isMedia = definition.app === "media";
  const usesNetwork = Boolean(definition.capabilities.network);
  const productHref = localizeHref(isMedia ? "/media" : "/devtools", locale);
  const productName = common(isMedia ? "media" : "developer");
  const privacyBadge = t(usesNetwork ? "onlineService" : isMedia ? "privateFiles" : "privateBrowser");
  const PrivacyIcon = usesNetwork ? Globe2 : LockKeyhole;
  const capabilityBadge = definition.labels.primaryAction?.toUpperCase() ?? t(isMedia ? "fileTool" : "browserTool");
  const supportItems = [
    ...(content.limitations?.length
      ? [
          {
            icon: AlertTriangle,
            eyebrow: t("limitations"),
            warning: true,
            items: content.limitations,
          },
        ]
      : []),
    ...(content.howToUse.length
      ? [{ icon: ListChecks, eyebrow: t("howToUse"), items: content.howToUse, warning: false }]
      : []),
  ];

  return (
    <>
      {usesNetwork ? <OfflineNoticeDialog toolName={title} /> : null}
      <ToolPageShell
        badge={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge className="border-0 bg-accent text-primary" variant="secondary">
              {capabilityBadge}
            </Badge>
            <Badge className="border-0 bg-accent text-primary" variant="secondary">
              <PrivacyIcon aria-hidden="true" className="size-3" />
              {privacyBadge}
            </Badge>
          </div>
        }
        breadcrumbCurrent={title}
        category={category}
        categoryHref={`${productHref}?category=${encodeURIComponent(categoryKey)}`}
        description={description}
        eyebrow={t(isMedia ? "mediaTool" : "developerTool")}
        footer={<CanopyFooter />}
        account={account}
        headerActions={<AccountNavigation {...account} />}
        productHref={productHref}
        productName={productName}
        skipHref="#tool-workspace"
        skipLabel={common("skipWorkspace")}
        showCategoryInBreadcrumb
        title={title}
        workspaceClassName="pb-4"
        workspaceId="tool-page-content"
      >
        <WorkbenchShell
          layoutStorageKey={`canopy:workbench-layout:${definition.definitionKey}`}
          workspaceTitle={title}
          aria-busy={isBusy || undefined}
          className="max-[56rem]:[&_[data-slot=workbench-toolbar-actions]]:w-full max-[56rem]:[&_[data-slot=workbench-toolbar-actions]]:min-w-0 max-[56rem]:[&_[data-slot=workbench-toolbar-actions]]:shrink"
          data-definition-key={definition.definitionKey}
          data-testid="tool-workspace"
          id="tool-workspace"
          status={
            <footer
              aria-live="polite"
              className="flex w-full min-w-0 items-center justify-between gap-4 text-muted-foreground"
              data-testid="tool-status-line"
              role="status"
            >
              <Caption
                className={`inline-flex min-w-0 items-center gap-2 ${
                  runtime.lifecycle === "completed" ? "text-success" : ""
                }`}
              >
                <Strong className="contents">
                  {runtime.lifecycle === "completed" ? (
                    <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                  ) : runtime.lifecycle === "invalid" || runtime.lifecycle === "failed" ? (
                    <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
                  ) : null}
                  <span className="truncate">{status}</span>
                  {runtime.canUndo && !runtime.pendingConfirmation ? (
                    <Button
                      className="relative h-7 px-2 after:absolute after:-inset-x-1 after:-inset-y-2"
                      onClick={runtime.undo}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Undo2 aria-hidden="true" className="size-3.5" />
                      {t("undo")}
                    </Button>
                  ) : null}
                </Strong>
              </Caption>
            </footer>
          }
          statusMeta={statusMeta ?? (runtime.lifecycle === "completed" && StatusMeta ? <StatusMeta /> : undefined)}
          tabIndex={-1}
          toolbar={
            <IconTile
              aria-hidden="true"
              className="size-[34px] bg-transparent text-foreground"
              tone={workbenchMarkText ? workbenchMark?.tone : undefined}
            >
              {workbenchIcon ??
                (workbenchMarkText ? (
                  <Caption>
                    <Strong>{workbenchMarkText}</Strong>
                  </Caption>
                ) : (
                  <Wrench />
                ))}
            </IconTile>
          }
          toolbarActions={
            <div
              aria-label={t("toolActions", { name: title })}
              className="flex min-w-0 items-center gap-2 [&_button]:min-w-0 [&_button[data-size=default]]:!h-11 [&_button[data-size=default]]:!gap-2 [&_button[data-size=default]]:!px-4 [&_button[data-size=default]_svg]:!size-[18px] [&_button[data-variant=default]:enabled]:!bg-primary [&_button[data-variant=default]:enabled]:!text-primary-foreground [&_button[data-variant=default]:enabled:hover]:!bg-primary/90 max-[56rem]:w-full max-[56rem]:flex-wrap max-[56rem]:justify-end max-[24rem]:[&_button]:max-w-full max-[24rem]:[&_button]:overflow-hidden max-[24rem]:[&_button_svg]:hidden"
              data-testid="tool-action-toolbar"
              role="toolbar"
            >
              <Toolbar />
            </div>
          }
          variant={isMedia ? "media" : "utility"}
        >
          <section
            aria-label={t("toolWorkspace", { name: title })}
            className="relative h-full min-h-0 min-w-0 overflow-hidden"
            data-testid="tool-workspace-content"
          >
            <Workspace />
          </section>
        </WorkbenchShell>

        {runtime.pendingConfirmation ? (
          <ConfirmationDialog
            changes={runtime.lastChanges}
            confirmLabel={runtime.pendingConfirmation.confirmLabel}
            description={runtime.pendingConfirmation.description}
            onCancel={runtime.cancelPendingCommand}
            onConfirm={runtime.confirmPendingCommand}
            title={runtime.pendingConfirmation.title}
          />
        ) : null}

        <section
          aria-labelledby="before-you-continue-heading"
          className="mt-4 border-t border-border pt-4"
          data-testid="tool-support"
        >
          <Overline className="text-primary" id="before-you-continue-heading">
            {t("beforeContinue")}
          </Overline>
          <div
            className={`mt-3 grid gap-3 max-[52rem]:grid-cols-1 ${supportItems.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {supportItems.map((item) => {
              const Icon = item.icon;
              return (
                <article className="rounded-lg border border-border bg-muted/55 px-4 py-3" key={item.eyebrow}>
                  <Overline className="flex items-center gap-2">
                    <Icon aria-hidden="true" className={`size-4 ${item.warning ? "text-amber-700" : "text-primary"}`} />
                    {item.eyebrow}
                  </Overline>
                  <List className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                    {item.items.map((text, index) => (
                      <li key={`${item.eyebrow}-${index}`}>{text}</li>
                    ))}
                  </List>
                </article>
              );
            })}
          </div>

          <div className="mt-4 flex min-h-20 items-center justify-between gap-6 py-3 max-[52rem]:items-start max-[52rem]:flex-col">
            <div>
              <Overline className="flex items-center gap-2">
                <ArrowLeftRight aria-hidden="true" className="size-4 text-primary" />
                {t("relatedTools")}
              </Overline>
              <H2 className="mt-1">{t("continueRelated")}</H2>
              <Muted className="mt-1 text-muted-foreground">{t("relatedDescription")}</Muted>
            </div>
            <nav
              aria-label={t("relatedCategory", { category })}
              className="flex shrink-0 flex-wrap justify-end gap-2 max-[52rem]:justify-start"
            >
              {relatedTools.map((tool) => (
                <Button className="h-9 rounded-lg" asChild key={tool.href} size="sm" variant="outline">
                  <a href={tool.href}>
                    {tool.label}
                    <ArrowUpRight aria-hidden="true" className="size-3.5" />
                  </a>
                </Button>
              ))}
            </nav>
          </div>
        </section>
      </ToolPageShell>
    </>
  );
}

function lifecycleLabel(definition: ToolDefinition, lifecycle: ToolLifecycle, t: ReturnType<typeof useTranslations>) {
  switch (lifecycle) {
    case "empty":
      return t("readyInput");
    case "running":
      return definition.labels.running;
    case "ready":
      return definition.labels.primaryAction
        ? t("readyAction", { action: definition.labels.primaryAction })
        : t("readyRun");
    case "completed":
      return definition.labels.ready;
    case "invalid":
      return t("inputAttention");
    case "failed":
      return t("actionFailed");
  }
}

export function UniversalWorkbench<Input, Settings extends ToolSettings, Result>({
  runtimeSpec,
  ...props
}: UniversalWorkbenchProps<Input, Settings, Result>) {
  return (
    <ToolRuntimeProvider analyticsToolKey={props.definition.definitionKey} spec={runtimeSpec}>
      <WorkbenchFrame {...props} />
    </ToolRuntimeProvider>
  );
}
