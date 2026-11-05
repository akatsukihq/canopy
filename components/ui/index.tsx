import { useLocale, useTranslations } from "next-intl";
import { localizeHref, type Locale } from "@/lib/i18n/config";
import { LanguageSelector } from "@/components/canopy/LanguageSelector";
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./components/accordion.tsx";
export { InlineTextEditor, type InlineTextEditorProps } from "./components/InlineTextEditor.tsx";
export { KeyValueFields, type KeyValueFieldsProps } from "./components/KeyValueFields.tsx";
import { Caption, Display, H1, H2, Large, Lead, Muted, Overline, P, Strong, Text } from "./components/typography.tsx";
export {
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  Display,
  P,
  Text,
  Lead,
  Large,
  Small,
  Muted,
  Caption,
  Overline,
  Metric,
  Strong,
  Blockquote,
  List,
  OrderedList,
  InlineCode,
  TextLink,
  CodeBlock,
  typographyStyles,
} from "./components/typography.tsx";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { SavedToolsTrigger, SaveToolButton } from "./components/SavedTools.tsx";
export { SavedToolsProvider, SavedToolsTrigger, SaveToolButton } from "./components/SavedTools.tsx";
import { cloneElement } from "react";
import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes, ReactElement, ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "./components/alert.tsx";
import { Badge } from "./components/badge.tsx";
import { Checkbox as CheckboxControl } from "./components/checkbox.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/tooltip.tsx";
export { ErrorPage, RouteError, type ErrorPageProps } from "./components/ErrorPage.tsx";
export { ContentState, ContentState as EmptyState, type ContentStateProps } from "./components/ContentState.tsx";
import {
  Field as FieldRoot,
  FieldDescription as FieldPrimitiveDescription,
  FieldError as FieldPrimitiveError,
  FieldLabel as FieldPrimitiveLabel,
} from "./components/field.tsx";
import { EcosystemTabFilters } from "./components/EcosystemTabFilters.tsx";
import { GlobalToolSearch } from "./components/GlobalToolSearch.tsx";
import { MobileNavigation } from "./components/MobileNavigation.tsx";
import type { AccountNavigationProps } from "./components/AccountNavigation.tsx";
import { ToolPageIntro } from "./components/patterns.tsx";
import { ScrollAwareHeader } from "./components/ScrollAwareHeader.tsx";
import { cn } from "./lib/utils.ts";

export { DESIGN_SYSTEM_COMPONENTS } from "./design-system-manifest.ts";
export type { DesignSystemComponentDefinition } from "./design-system-manifest.ts";
export { Alert, AlertDescription, AlertTitle };
export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./components/avatar.tsx";
export { Badge, badgeVariants } from "./components/badge.tsx";
export { FileChip } from "./components/file-chip.tsx";
export { WorkspacePanelHeader } from "./components/WorkspacePanelHeader.tsx";
export { Button, buttonVariants, ToolActionButton } from "./components/button.tsx";
export { CanvasHandle } from "./components/canvas-handle.tsx";
export { Pagination, type PaginationProps } from "./components/Pagination.tsx";
export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants } from "./components/button-group.tsx";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/card.tsx";
export { ChapterScrubber } from "./components/ChapterScrubber.tsx";
export type { Chapter, ChapterScrubberProps } from "./components/ChapterScrubber.tsx";
export { OrderableList } from "./components/OrderableList.tsx";
export { SelectionHighlight, type SelectionHighlightProps } from "./components/SelectionHighlight.tsx";
export { ColorControl } from "./components/ColorControl.tsx";
export type { ColorControlProps } from "./components/ColorControl.tsx";
export { ColorSwatch } from "./components/ColorSwatch.tsx";
export type { OrderableItemState } from "./components/OrderableList.tsx";
export { MediaOutputCard } from "./components/MediaOutputCard.tsx";
export type { MediaOutputCardProps } from "./components/MediaOutputCard.tsx";
export { MediaPreview } from "./components/MediaPreview.tsx";
export type { MediaPreviewProps } from "./components/MediaPreview.tsx";
export { PdfViewer } from "./components/PdfViewer.tsx";
export type { PdfOutlineItem, PdfViewerProps } from "./components/PdfViewer.tsx";
export { CheckboxControl };
export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./components/empty.tsx";
export {
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  Field as FieldRoot,
} from "./components/field.tsx";
export { Input, inputVariants } from "./components/input.tsx";
export type { InputProps } from "./components/input.tsx";
export { AutocompleteInput, type AutocompleteInputProps } from "./components/autocomplete.tsx";
export { Label } from "./components/label.tsx";
export { Popover } from "radix-ui";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
} from "./components/select.tsx";
export type { SelectProps, SelectSize } from "./components/select.tsx";
export { RadioGroup, RadioGroupItem, radioGroupItemVariants } from "./components/radio-group.tsx";
export type { RadioGroupItemProps } from "./components/radio-group.tsx";
export {
  DataConversionWorkbench,
  JsonFormatterWorkbench,
  SegmentedControl,
  Tag,
  Toast,
  ToolPageSystemControls,
  UtilityWorkbench,
  WorkbenchShell,
} from "./components/design-system-components.tsx";
export type { SegmentedControlItem, WorkbenchShellProps } from "./components/design-system-components.tsx";
export {
  CompactAction,
  DownloadResult,
  FileQueueItem,
  FileUploadZone,
  HowItWorks,
  IconTile,
  InlineGuidance,
  InlineProductHeader,
  MetricCard,
  ProcessingStatus,
  ProductFooter,
  RemoveFileAction,
  RightPanelProcessing,
  RightPanelResult,
  SidebarNavItem,
  ToolOptionsPanel,
  ToolPageIntro,
  ToolSupportSections,
  UniversalProductHeader,
} from "./components/patterns.tsx";
export { Separator } from "./components/separator.tsx";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup, usePanelRef } from "./components/resizable.tsx";
export { ScrollArea, ScrollBar } from "./components/scroll-area.tsx";
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/alert-dialog.tsx";
export { toast, Toaster } from "./components/toast.tsx";
export { Switch } from "./components/switch.tsx";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/table.tsx";
export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "./components/tabs.tsx";
export { BackButton } from "./components/BackButton.tsx";
export { ActionMenuButton, CreateMenuButton } from "./components/ActionMenuButton.tsx";
export { Textarea } from "./components/textarea.tsx";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip.tsx";

export function AppContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-[1328px] px-4 lg:px-16", className)} {...props} />;
}

export { AccountNavigation } from "./components/AccountNavigation.tsx";
export type { AccountNavigationProps } from "./components/AccountNavigation.tsx";

type SmartToolsLogoMarkProps = Omit<ComponentProps<"img">, "alt" | "src"> & {
  alt?: string;
  mode?: "light" | "dark";
  title?: string;
};

export function SmartToolsLogoMark({ alt, className, mode = "light", title, ...props }: SmartToolsLogoMarkProps) {
  return (
    <img
      alt={alt ?? title ?? ""}
      className={cn("block", className)}
      height={160}
      src={mode === "dark" ? "/logo-dark.svg" : "/logo.svg"}
      width={160}
      {...props}
    />
  );
}

export function BrandLockup({ className, href, name }: { className?: string; href: string; name: string }) {
  return (
    <a
      className={cn(
        "inline-flex h-[30px] items-stretch gap-2 rounded-lg text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      href={href}
    >
      <SmartToolsLogoMark className="aspect-square h-full w-auto shrink-0" />
      <span className="flex h-full flex-col justify-center gap-1 leading-none">
        <Text className="block">{name}</Text>
        {name !== "SmartTools" ? <Caption className="block text-muted-foreground">by SmartTools</Caption> : null}
      </span>
    </a>
  );
}

export function ProductHeader({
  actions,
  className,
  compact = false,
  minimal = false,
  showSearch = true,
  account,
  publicSiteUrl = account?.publicSiteUrl,
  href,
  name,
  subtitle,
}: {
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
  minimal?: boolean;
  showSearch?: boolean;
  account?: AccountNavigationProps;
  publicSiteUrl?: string;
  href: string;
  name: string;
  subtitle?: string;
}) {
  const t = useTranslations("Common");
  const locale = useLocale() as Locale;
  return (
    <ScrollAwareHeader
      aria-label={t("navigation")}
      className={cn("border-b border-border bg-card print:hidden", className)}
      data-product-name={name}
    >
      <AppContainer
        className={cn(
          "flex max-w-[1440px] flex-nowrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-10",
          !minimal &&
            "compact:max-navigation:grid compact:max-navigation:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] compact:max-navigation:gap-2",
          compact ? "min-h-[72px]" : "min-h-[72px] xl:min-h-[88px]",
        )}
      >
        <a
          aria-label={t("home")}
          className="flex w-fit shrink-0 items-center gap-2 rounded-lg text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 compact:col-start-1 compact:row-start-1"
          href={publicSiteUrl ? new URL(localizeHref("/", locale), publicSiteUrl).href : localizeHref("/", locale)}
        >
          <SmartToolsLogoMark className={cn("shrink-0", compact ? "size-10" : "size-10 xl:size-12")} />
          <span className={cn("flex flex-col gap-0.5 max-[360px]:hidden", !minimal && "navigation:max-2xl:hidden")}>
            <Strong className="">
              Smart<span className="text-primary">Tools</span>
            </Strong>
            <Caption className={cn("text-muted-foreground", subtitle === undefined && "hidden xl:block")}>
              {subtitle ?? t("tagline")}
            </Caption>
          </span>
        </a>

        {!minimal && showSearch ? <GlobalToolSearch publicSiteUrl={publicSiteUrl} /> : null}

        {!minimal ? <EcosystemTabFilters currentHref={href} publicSiteUrl={publicSiteUrl} /> : null}

        <div className="flex shrink-0 items-center gap-2 compact:col-start-3 compact:row-start-1 compact:justify-self-end">
          <LanguageSelector />
          <div
            className={cn(
              "shrink-0 items-center gap-2",
              minimal ? "flex" : "hidden compact:flex compact:max-xl:[&_button>.truncate]:hidden",
            )}
          >
            {!minimal ? <SavedToolsTrigger className="hidden h-10 rounded-full navigation:inline-flex" /> : null}
            {actions}
          </div>
          {!minimal ? (
            <MobileNavigation
              account={account}
              publicSiteUrl={publicSiteUrl}
              currentHref={href}
              showSearch={showSearch}
            />
          ) : null}
        </div>
      </AppContainer>
    </ScrollAwareHeader>
  );
}

export type ToolPageShellProps = {
  badge?: ReactNode;
  breadcrumbCurrent?: ReactNode;
  category: string;
  categoryHref: string;
  children: ReactNode;
  description: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  account?: AccountNavigationProps;
  productHref: string;
  productName: string;
  skipHref?: string;
  skipLabel?: ReactNode;
  showIntro?: boolean;
  showCategoryInBreadcrumb?: boolean;
  systemControls?: ReactNode;
  title: string;
  workspaceClassName?: string;
  workspaceId?: string;
};

export function ToolPageShell({
  badge,
  breadcrumbCurrent,
  category,
  categoryHref,
  children,
  description,
  eyebrow,
  footer,
  headerActions,
  account,
  productHref,
  productName,
  skipHref = "#tool-workspace",
  skipLabel,
  showIntro = true,
  showCategoryInBreadcrumb = true,
  systemControls,
  title,
  workspaceClassName,
  workspaceId = "tool-workspace",
}: ToolPageShellProps) {
  const t = useTranslations("Common");
  const locale = useLocale() as Locale;
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        className="fixed top-3 left-3 z-[100] -translate-y-[180%] rounded-lg bg-primary px-3.5 py-2.5 font-bold text-primary-foreground shadow-sm focus:translate-y-0"
        href={skipHref}
      >
        {skipLabel ?? t("skipWorkspace")}
      </a>

      <ProductHeader
        actions={headerActions}
        account={account}
        className="sticky top-0 z-50 border-border bg-card"
        compact
        href={localizeHref(productHref, locale)}
        name={productName}
      />

      <main className="flex-1 bg-card">
        <section className="bg-card">
          <AppContainer className="max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-10">
            <nav aria-label={t("breadcrumb")} className="flex min-h-8 items-center justify-between gap-3">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 font-caption text-xs font-normal text-muted-foreground">
                <li>
                  <a
                    className="rounded-sm px-1.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    href={localizeHref(`${productHref}?view=all`, locale)}
                  >
                    {t("allTools")}
                  </a>
                </li>
                <li aria-hidden="true" className="text-input">
                  ›
                </li>
                <li>
                  <a
                    className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    href={localizeHref(productHref, locale)}
                  >
                    {productName}
                  </a>
                </li>
                {showCategoryInBreadcrumb ? (
                  <>
                    <li aria-hidden="true" className="text-input">
                      ›
                    </li>
                    <li>
                      <a
                        className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        href={localizeHref(categoryHref, locale)}
                      >
                        {category}
                      </a>
                    </li>
                  </>
                ) : null}
                <li aria-hidden="true" className="text-input">
                  ›
                </li>
                <li aria-current="page" className="min-w-0 truncate font-semibold text-foreground">
                  {breadcrumbCurrent ?? title}
                </li>
              </ol>
              <SaveToolButton href={account?.returnTo} />
            </nav>
          </AppContainer>
        </section>
        {!showIntro ? <H1 className="sr-only">{title}</H1> : null}
        {showIntro ? (
          <section className="bg-card">
            <AppContainer className="max-w-[1440px] px-4 pt-[18px] sm:px-6 lg:px-10">
              <ToolPageIntro badge={badge} category={eyebrow ?? category} description={description} title={title} />
            </AppContainer>
          </section>
        ) : null}

        <AppContainer
          className={cn("max-w-[1440px] px-4 pt-[18px] pb-8 outline-none sm:px-6 lg:px-10", workspaceClassName)}
          id={workspaceId}
          tabIndex={-1}
        >
          {systemControls ? <div className="mb-8">{systemControls}</div> : null}
          {children}
        </AppContainer>
      </main>

      {footer}
    </div>
  );
}

export function ToolNav({
  ariaLabel = "Tools",
  className,
  items,
}: {
  ariaLabel?: string;
  className?: string;
  items: readonly { current?: boolean; href: string; label: string }[];
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("overflow-x-auto", className)}>
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <a
            aria-current={item.current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center whitespace-nowrap rounded-lg px-3 font-sans text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              item.current ? "bg-accent font-semibold text-primary" : "text-foreground hover:bg-muted",
            )}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function PageHero({
  align = "left",
  actions,
  className,
  compact = false,
  description,
  eyebrow,
  title,
}: {
  align?: "left" | "center";
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
  description: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  const Title = compact ? H1 : Display;
  const Description = compact ? P : Lead;

  return (
    <section className={cn(compact ? "py-10 lg:py-12" : "py-16 lg:py-20", className)}>
      <AppContainer>
        {eyebrow ? (
          <Overline
            className={cn("block text-primary", compact ? "mb-3" : "mb-4", align === "center" && "text-center")}
          >
            {eyebrow}
          </Overline>
        ) : null}
        <Title className={cn("max-w-3xl text-foreground", align === "center" && "mx-auto text-center")}>{title}</Title>
        <Description
          className={cn(
            "max-w-2xl text-muted-foreground",
            compact ? "mt-3" : "mt-5",
            align === "center" && "mx-auto text-center",
          )}
        >
          {description}
        </Description>
        {actions ? (
          <div
            className={cn(compact ? "mt-5" : "mt-8", "flex flex-wrap gap-3", align === "center" && "justify-center")}
          >
            {actions}
          </div>
        ) : null}
      </AppContainer>
    </section>
  );
}

export function ToolPageHeader({
  actions,
  className,
  description,
  eyebrow,
  inlineEyebrow = false,
  title,
}: {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  inlineEyebrow?: boolean;
  title: ReactNode;
}) {
  const titleNode = <H1 className={cn("text-foreground", inlineEyebrow && "min-w-0 break-words")}>{title}</H1>;
  const eyebrowNode = eyebrow ? (
    <Overline className={cn("flex flex-wrap items-center gap-2 text-primary", inlineEyebrow ? "max-w-full" : "mb-2")}>
      {eyebrow}
    </Overline>
  ) : null;

  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className={cn(inlineEyebrow && "min-w-0")}>
        {inlineEyebrow ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {titleNode}
            {eyebrowNode}
          </div>
        ) : (
          <>
            {eyebrowNode}
            {titleNode}
          </>
        )}
        {description ? <Muted className="text-muted-foreground">{description}</Muted> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  action,
  back,
  className,
  description,
  eyebrow,
  title,
}: {
  action?: ReactNode;
  /** Back control shown on the same row as the title. */
  back?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div>
        {eyebrow ? <Overline className="mb-2 block text-primary">{eyebrow}</Overline> : null}
        {back ? (
          <div className="flex items-center gap-2">
            {back}
            <H2 className="text-foreground">{title}</H2>
          </div>
        ) : (
          <H2 className="text-foreground">{title}</H2>
        )}
        {description ? <P className="mt-2 text-muted-foreground">{description}</P> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  children,
  className,
  description,
  error,
  htmlFor,
  label,
  required,
  variant = "default",
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "aria-errormessage"?: string;
    "aria-invalid"?: boolean | "false" | "grammar" | "spelling" | "true";
    id?: string;
  }>;
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  label: ReactNode;
  required?: boolean;
  variant?: "default" | "auth";
}) {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;
  const errorMessage = [children.props["aria-errormessage"], errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldRoot className={className} data-invalid={Boolean(error)} variant={variant}>
      <FieldPrimitiveLabel htmlFor={htmlFor} required={required}>
        {label}
      </FieldPrimitiveLabel>
      {cloneElement(children, {
        "aria-describedby": describedBy,
        "aria-errormessage": errorMessage,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        id: htmlFor,
      })}
      {description ? <FieldPrimitiveDescription id={descriptionId}>{description}</FieldPrimitiveDescription> : null}
      {error ? <FieldPrimitiveError id={errorId}>{error}</FieldPrimitiveError> : null}
    </FieldRoot>
  );
}

export function AuthField(props: Omit<ComponentProps<typeof Field>, "variant">) {
  return <Field variant="auth" {...props} />;
}

export function Checkbox({
  className,
  description,
  label,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof CheckboxControl>, "className"> & {
  className?: string;
  description?: ReactNode;
  label: ReactNode;
  tooltip?: ReactNode;
}) {
  const checkbox = <CheckboxControl className="mt-0.5" {...props} />;
  const control = (
    <label className={cn("flex min-h-10 items-start gap-3 text-sm text-foreground", className)}>
      {tooltip && !props.disabled ? <TooltipTrigger asChild>{checkbox}</TooltipTrigger> : checkbox}
      <span>
        <span className="block font-semibold">{label}</span>
        {description ? <span className="mt-1 block leading-5 text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
  return tooltip ? (
    <Tooltip>
      {props.disabled ? (
        <TooltipTrigger asChild>
          <span
            className="block rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            tabIndex={0}
            role="group"
            aria-label={typeof label === "string" ? label : undefined}
            aria-disabled="true"
          >
            {control}
          </span>
        </TooltipTrigger>
      ) : (
        control
      )}
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    control
  );
}

const cardClassName =
  "rounded-xl border border-border bg-card p-6 text-card-foreground shadow-[0_2px_4px_#00000008,0_12px_32px_#0000000f]";

export function SectionCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn(cardClassName, "space-y-6", className)} {...props} />;
}

export function DangerZone({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-foreground", className)}
      {...props}
    />
  );
}

export function CatalogCard({
  action,
  className,
  description,
  icon,
  status,
  title,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  action: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="relative h-full">
      <a
        className={cn(
          "group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
        {...props}
      >
        {icon || status ? (
          <span className="flex items-center justify-between gap-3 pr-12">
            {icon ? (
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-lg bg-accent text-primary [&_svg]:size-[22px]"
              >
                {icon}
              </span>
            ) : null}
            {status ? <span className="min-w-0">{status}</span> : null}
          </span>
        ) : null}
        <Large className={icon || status ? undefined : "pr-12"}>{title}</Large>
        <Caption className="-mt-2 text-muted-foreground">{description}</Caption>
        <Caption className="mt-auto text-primary group-hover:underline">{action}</Caption>
      </a>
      <div className="absolute top-5 right-5">
        <SaveToolButton href={props.href} iconOnly />
      </div>
    </div>
  );
}

export function ToolCard(props: ComponentProps<typeof CatalogCard>) {
  return <CatalogCard data-slot="tool-card" {...props} />;
}

type StatusVariant = "neutral" | "info" | "success" | "warning" | "danger" | "archived";

export function StatusBadge({
  children,
  className,
  variant = "neutral",
}: {
  children: ReactNode;
  className?: string;
  variant?: StatusVariant;
}) {
  const variants: Record<StatusVariant, { badge: string; dot: string }> = {
    neutral: { badge: "border-input bg-card text-muted-foreground", dot: "bg-muted-foreground" },
    info: { badge: "border-transparent bg-accent text-primary", dot: "bg-primary" },
    success: { badge: "border-transparent bg-success-soft text-success", dot: "bg-success" },
    warning: {
      badge: "border-transparent bg-status-warning-soft text-status-warning",
      dot: "bg-status-warning",
    },
    danger: {
      badge: "border-transparent bg-status-danger-soft text-status-danger",
      dot: "bg-status-danger",
    },
    archived: {
      badge: "border-transparent bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
    },
  };
  const styles = variants[variant];

  return (
    <Badge className={cn(styles.badge, className)} variant="secondary">
      <span aria-hidden="true" className={cn("size-[7px] rounded-full", styles.dot)} />
      {children}
    </Badge>
  );
}

type AlertVariant = "info" | "success" | "warning" | "error";

export function AlertBanner({
  action,
  children,
  className,
  title,
  variant = "info",
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  variant?: AlertVariant;
}) {
  const variants: Record<AlertVariant, string> = {
    info: "border-transparent bg-accent text-foreground [&>svg]:text-primary",
    success: "border-transparent bg-success-soft text-foreground [&>svg]:text-success",
    warning: "border-transparent bg-status-warning-soft text-foreground [&>svg]:text-status-warning",
    error: "border-transparent bg-status-danger-soft text-foreground [&>svg]:text-status-danger",
  };
  const urgent = variant === "error";
  const icons = {
    info: <Info className="text-primary" />,
    success: <CircleCheck className="text-success" />,
    warning: <TriangleAlert className="text-status-warning" />,
    error: <CircleX className="text-status-danger" />,
  };

  return (
    <Alert
      className={cn("flex flex-wrap items-start justify-between gap-3 p-4", variants[variant], className)}
      role={urgent ? "alert" : "status"}
      variant={urgent ? "destructive" : "default"}
    >
      {icons[variant]}
      <div className="min-w-0 flex-1">
        {title ? <AlertTitle className="col-auto line-clamp-none">{title}</AlertTitle> : null}
        <AlertDescription className={cn("col-auto block text-inherit", title ? "mt-1" : undefined)}>
          {children}
        </AlertDescription>
      </div>
      {action}
    </Alert>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./components/dropdown-menu.tsx";
