"use client";

import { appHref } from "@/lib/routing/subdomains.ts";
import { AdminListing } from "../../components/AdminListing";
import { paginateAdminItems } from "../../lib/pagination";
import { SubmitButton } from "@/app/admin/(protected)/components/SubmitButton";

import type { ToolApp } from "@/lib/tool-catalog/index.ts";
import type { AdminTool } from "../../../../../lib/tool-framework/manifest";
import { OrderableList, type OrderableItemState } from "@/components/ui/components/OrderableList.tsx";
import {
  H3,
  Caption,
  Lead,
  Muted,
  Overline,
  Text,
  Button,
  Field,
  IconTile,
  ContentState,
  Input,
  Label,
  Select,
  StatusBadge,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import {
  Boxes,
  Braces,
  BriefcaseBusiness,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  History,
  LayoutGrid,
  Pencil,
  RotateCcw,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { updateAdminQuery, useAdminQueryState } from "@/app/admin/hooks/useAdminQueryState";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ToolIcon } from "../../../../../components/ToolIcon";
import { archiveToolAction, reorderToolsAction, toggleToolAction, updateToolAction } from "../../../actions";

const GROUPS: readonly {
  app: ToolApp;
  description: string;
  icon: LucideIcon;
  title: string;
}[] = [
  {
    app: "paperwork",
    title: "Paperwork",
    description: "Documents and business workflows",
    icon: BriefcaseBusiness,
  },
  {
    app: "devtools",
    title: "Developer tools",
    description: "Data, code, and web utilities",
    icon: Braces,
  },
  {
    app: "media",
    title: "Media tools",
    description: "PDF and image processing",
    icon: Boxes,
  },
];

type AppFilter = "all" | ToolApp;
type VisibilityFilter = "all" | "visible" | "hidden" | "draft" | "setup" | "archived";

function sortByOrder(tools: readonly AdminTool[]) {
  return [...tools].sort((left, right) => left.order - right.order);
}

function isVisible(tool: AdminTool) {
  return Boolean(tool.enabled && !tool.archived && tool.slug);
}

function matchesVisibility(tool: AdminTool, filter: VisibilityFilter) {
  if (filter === "visible") return isVisible(tool);
  if (filter === "hidden") return Boolean(tool.slug && !tool.enabled && !tool.archived);
  if (filter === "draft") return tool.hasDraftContent && !tool.archived;
  if (filter === "setup") return !tool.slug && !tool.archived;
  if (filter === "archived") return tool.archived;
  return true;
}

function ToolStatus({ tool }: { tool: AdminTool }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <ToolVisibility tool={tool} />
      {tool.hasSpecDraft ? <StatusBadge variant="warning">Draft</StatusBadge> : null}
    </span>
  );
}

function ToolVisibility({ tool }: { tool: AdminTool }) {
  if (tool.archived) return <StatusBadge variant="archived">Archived</StatusBadge>;
  if (!tool.slug) return <StatusBadge variant="warning">Setup required</StatusBadge>;
  // The row exists but its code has not shipped, so visitors cannot reach it
  // however this row is configured.
  if (!tool.hasDefinition) return <StatusBadge variant="warning">Awaiting code</StatusBadge>;
  if (tool.enabled) return <StatusBadge variant="success">Visible</StatusBadge>;
  return <StatusBadge>Hidden</StatusBadge>;
}

function ToolToggle({ tool }: { tool: AdminTool }) {
  const [checked, setChecked] = useState(tool.enabled);
  const [isPending, startTransition] = useTransition();

  useEffect(() => setChecked(tool.enabled), [tool.enabled]);

  function handleCheckedChange(enabled: boolean) {
    const previous = checked;
    setChecked(enabled);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("toolId", tool.id);
      formData.set("enabled", String(enabled));
      try {
        await toggleToolAction(formData);
      } catch {
        setChecked(previous);
      }
    });
  }

  return (
    <Switch
      aria-label={`${checked ? "Hide" : "Show"} ${tool.name}`}
      checked={checked}
      disabled={isPending}
      onCheckedChange={handleCheckedChange}
      size="default"
    />
  );
}

function ToolConfiguration({ onClose, tool }: { onClose: () => void; tool: AdminTool }) {
  return (
    <div className="border-t border-border bg-muted/40 px-5 py-5 sm:px-6">
      <form action={updateToolAction} className="grid gap-4 lg:grid-cols-2">
        <input name="toolId" type="hidden" value={tool.id} />
        <input name="archived" type="hidden" value="true" />
        <Field className={tool.slug ? "lg:col-span-2" : undefined} htmlFor={`${tool.id}-name`} label="Name" required>
          <Input defaultValue={tool.name} id={`${tool.id}-name`} maxLength={160} name="name" required />
        </Field>
        {!tool.slug ? (
          <Field
            description="Use lowercase letters, numbers, and single hyphens."
            htmlFor={`${tool.id}-slug`}
            label="Slug"
            required
          >
            <Input
              id={`${tool.id}-slug`}
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="lowercase-single-hyphens"
              required
            />
          </Field>
        ) : null}
        <Field className="lg:col-span-2" htmlFor={`${tool.id}-description`} label="Description" required>
          <Textarea
            defaultValue={tool.description}
            id={`${tool.id}-description`}
            maxLength={2000}
            name="description"
            required
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
          <SubmitButton formAction={updateToolAction} type="submit">
            Save configuration
          </SubmitButton>
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <SubmitButton
            className="sm:ml-auto"
            formAction={archiveToolAction}
            formNoValidate
            type="submit"
            variant="danger-subtle"
          >
            Archive tool
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

function ToolDescription({ description }: { description: string }) {
  const descriptionRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    const target: HTMLSpanElement = element;

    function updateTruncation() {
      setIsTruncated(target.scrollWidth > target.clientWidth);
    }

    updateTruncation();
    const observer = new ResizeObserver(updateTruncation);
    observer.observe(target);
    return () => observer.disconnect();
  }, [description]);

  const content = (
    <Caption
      className={`mt-0.5 block truncate text-muted-foreground ${
        isTruncated ? "cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""
      }`}
      ref={descriptionRef}
      tabIndex={isTruncated ? 0 : undefined}
    >
      {description}
    </Caption>
  );

  if (!isTruncated) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-sm" side="bottom">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolRow({
  orderable,
  tool,
  publicSiteUrl,
}: {
  orderable: OrderableItemState;
  tool: AdminTool;
  publicSiteUrl: string;
}) {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const isSetupRequired = !tool.slug && !tool.archived;

  return (
    <div
      className={`${isSetupRequired ? "bg-amber-50/70" : "bg-card"} ${
        tool.archived ? "text-muted-foreground" : ""
      } ${orderable.isDragging ? "relative z-10 shadow-lg ring-1 ring-primary/20" : ""}`}
    >
      <div className="grid min-h-16 gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            {...orderable.attributes}
            {...orderable.listeners}
            aria-label={`Reorder ${tool.name}`}
            className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            disabled={orderable.disabled}
            ref={orderable.setActivatorNodeRef}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <GripVertical aria-hidden="true" className="size-[18px]" />
          </Button>
          <IconTile
            aria-hidden="true"
            className={isSetupRequired ? "bg-amber-200/70 text-amber-800" : undefined}
            size="sm"
            tone="muted"
          >
            {isSetupRequired ? (
              <TriangleAlert strokeWidth={1.8} />
            ) : (
              <ToolIcon name={tool.name} media={tool.icon} size={20} toolId={tool.id} />
            )}
          </IconTile>
          <span className="min-w-0 flex-1">
            <Text className="block truncate text-foreground">{tool.name}</Text>
            <ToolDescription description={tool.description} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
          <ToolStatus tool={tool} />
          {!tool.archived && tool.slug ? <ToolToggle tool={tool} /> : null}
          {tool.archived ? (
            <form action={archiveToolAction}>
              <input name="toolId" type="hidden" value={tool.id} />
              <input name="archived" type="hidden" value="false" />
              <SubmitButton size="sm" type="submit" variant="secondary">
                Restore
              </SubmitButton>
            </form>
          ) : isSetupRequired ? (
            <Button
              aria-expanded={isConfiguring}
              onClick={() => setIsConfiguring((open) => !open)}
              size="sm"
              type="button"
            >
              Finish setup
            </Button>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="icon-sm" variant="ghost">
                    <Link
                      aria-label={`Open ${tool.name} in a new tab`}
                      href={new URL(`/${tool.app}/${tool.slug}`, publicSiteUrl).href}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open {tool.name} in a new tab</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="icon-sm" variant="ghost">
                    <Link
                      aria-label={`Edit ${tool.name}`}
                      href={appHref(`/admin/tools/${encodeURIComponent(tool.id)}`)}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit {tool.name}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {isConfiguring && !tool.archived ? (
        <ToolConfiguration onClose={() => setIsConfiguring(false)} tool={tool} />
      ) : null}
    </div>
  );
}

function ToolGroup({
  app,
  canReorder,
  title,
  tools,
  publicSiteUrl,
  visibleIds,
}: {
  app: ToolApp;
  canReorder: boolean;
  title: string;
  tools: readonly AdminTool[];
  publicSiteUrl: string;
  visibleIds: ReadonlySet<string>;
}) {
  const [items, setItems] = useState(() => sortByOrder(tools));
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => setItems(sortByOrder(tools)), [tools]);

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, AdminTool[]>();
    for (const tool of items) {
      const category = tool.category?.trim() || title;
      const categoryItems = groups.get(category) ?? [];
      categoryItems.push(tool);
      groups.set(category, categoryItems);
    }
    return [...groups.entries()];
  }, [items, title]);

  function handleReorder(category: string, nextCategoryItems: AdminTool[]) {
    const previousItems = items;
    let categoryIndex = 0;
    const nextItems = items.map((tool) =>
      (tool.category?.trim() || title) === category && visibleIds.has(tool.id)
        ? nextCategoryItems[categoryIndex++]
        : tool,
    );
    setItems(nextItems);
    setMessage("Saving order…");
    startTransition(async () => {
      try {
        await reorderToolsAction(
          app,
          nextItems.map((tool) => tool.id),
        );
        setMessage("Order saved.");
      } catch {
        setItems(previousItems);
        setMessage("Order could not be saved. Try again.");
      }
    });
  }

  function toggleCategory(category: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <section aria-labelledby={`${app}-tools-heading`} className="border-b border-border last:border-b-0">
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-muted px-4">
        <Overline className="text-muted-foreground" id={`${app}-tools-heading`}>
          {title}
        </Overline>
        <Caption className="text-muted-foreground">{items.length}</Caption>
        <Caption aria-live="polite" className="ml-auto text-muted-foreground" role="status">
          {message}
        </Caption>
      </div>
      {categoryGroups.map(([category, allCategoryItems]) => {
        const categoryItems = allCategoryItems.filter((tool) => visibleIds.has(tool.id));
        if (!categoryItems.length) return null;
        const collapsed = collapsedCategories.has(category);
        const showCategoryHeader = categoryGroups.length > 1 || category !== title;
        return (
          <div className="border-b border-border last:border-b-0" key={category}>
            {showCategoryHeader ? (
              <button
                aria-expanded={!collapsed}
                className="flex min-h-9 w-full items-center gap-2 border-b border-border bg-card px-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => toggleCategory(category)}
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`size-3.5 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
                />
                <Caption className="text-foreground">{category}</Caption>
                <Caption className="text-muted-foreground">{categoryItems.length}</Caption>
              </button>
            ) : null}
            {!collapsed ? (
              <OrderableList
                ariaLabel={`${category} order`}
                className="divide-y divide-border"
                disabled={!canReorder || isPending || categoryItems.length < 2}
                getId={(tool) => tool.id}
                items={categoryItems}
                onReorder={(nextItems) => handleReorder(category, nextItems)}
                renderItem={(tool, orderable) => (
                  <ToolRow orderable={orderable} tool={tool} publicSiteUrl={publicSiteUrl} />
                )}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function RailItem({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "bg-accent text-primary" : "text-foreground hover:bg-card"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <Text className="truncate">{label}</Text>
      <Caption className="ml-auto text-current opacity-70">{count}</Caption>
    </button>
  );
}

export interface ToolListProps {
  tools: readonly AdminTool[];
  publicSiteUrl: string;
}

export function ToolList({ tools, publicSiteUrl }: ToolListProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query] = useAdminQueryState<string>("q", "");
  const [rawPage, setPage] = useAdminQueryState<string>("page", "1");
  function setQuery(value: string, replace = false) {
    updateAdminQuery({ q: value || null, page: null }, replace);
  }
  const [selectedApp] = useAdminQueryState<AppFilter>("app", "all", ["all", ...GROUPS.map((group) => group.app)]);
  const [visibility] = useAdminQueryState<VisibilityFilter>("visibility", "all", [
    "all",
    "visible",
    "hidden",
    "draft",
    "setup",
    "archived",
  ]);
  const appFilter = visibility === "all" ? selectedApp : "all";

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.key !== "/" ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const counts = useMemo(
    () => ({
      all: tools.length,
      archived: tools.filter((tool) => tool.archived).length,
      hidden: tools.filter((tool) => matchesVisibility(tool, "hidden")).length,
      draft: tools.filter((tool) => matchesVisibility(tool, "draft")).length,
      setup: tools.filter((tool) => matchesVisibility(tool, "setup")).length,
      visible: tools.filter(isVisible).length,
    }),
    [tools],
  );

  const availableCategories = useMemo(() => {
    if (appFilter === "all") return [];
    return [
      ...new Set(
        tools
          .filter((tool) => tool.app === appFilter)
          .map((tool) => tool.category?.trim())
          .filter((category): category is string => Boolean(category)),
      ),
    ];
  }, [appFilter, tools]);

  const [categoryFilter] = useAdminQueryState("category", "all", ["all", ...availableCategories]);

  const filteredTools = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return tools.filter((tool) => {
      if (appFilter !== "all" && tool.app !== appFilter) return false;
      if (categoryFilter !== "all" && tool.category !== categoryFilter) return false;
      if (!matchesVisibility(tool, visibility)) return false;
      if (!normalizedQuery) return true;
      return [tool.name, tool.slug, tool.componentKey, tool.description, tool.category, ...(tool.keywords ?? [])].some(
        (value) => value?.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [appFilter, categoryFilter, query, tools, visibility]);

  const pagination = paginateAdminItems(
    GROUPS.flatMap((group) => sortByOrder(filteredTools.filter((tool) => tool.app === group.app))),
    rawPage,
  );
  const visibleIds = new Set(pagination.items.map((tool) => tool.id));
  const hasFilters = Boolean(query || appFilter !== "all" || categoryFilter !== "all" || visibility !== "all");
  const canReorder = !query.trim() && categoryFilter === "all" && visibility === "all";
  const resultsTitle =
    categoryFilter !== "all"
      ? categoryFilter
      : appFilter === "all"
        ? "All tools"
        : (GROUPS.find((group) => group.app === appFilter)?.title ?? "Tools");

  function selectApp(nextApp: AppFilter) {
    updateAdminQuery({ app: nextApp === "all" ? null : nextApp, category: null, visibility: null, page: null });
  }

  function setVisibility(nextVisibility: VisibilityFilter) {
    updateAdminQuery({
      visibility: nextVisibility === "all" ? null : nextVisibility,
      app: null,
      category: null,
      page: null,
    });
  }

  function resetFilters() {
    updateAdminQuery({ q: null, app: null, category: null, visibility: null, page: null });
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid shrink-0 gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_11rem_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="tool-search">Search tools</Label>
            <span className="relative block">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-10"
                id="tool-search"
                onChange={(event) => setQuery(event.target.value, true)}
                placeholder="Search by name, route, or capability…"
                ref={searchRef}
                value={query}
              />
            </span>
          </div>
          <Field htmlFor="tool-category-filter" label="Suite">
            <Select
              id="tool-category-filter"
              onChange={(event) => selectApp(event.target.value as AppFilter)}
              value={appFilter}
            >
              <option value="all">All suites</option>
              {GROUPS.map((group) => (
                <option key={group.app} value={group.app}>
                  {group.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="tool-visibility-filter" label="Visibility">
            <Select
              id="tool-visibility-filter"
              onChange={(event) => setVisibility(event.target.value as VisibilityFilter)}
              value={visibility}
            >
              <option value="all">Any status</option>
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="draft">Drafts</option>
              <option value="setup">Setup required</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Button disabled={!hasFilters} onClick={resetFilters} type="button" variant="secondary">
            <RotateCcw aria-hidden="true" className="size-4" />
            Reset
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[13.75rem_minmax(0,1fr)]">
          <aside
            className="border-b border-border bg-muted p-4 lg:h-full lg:border-r lg:border-b-0"
            aria-label="Catalog views"
          >
            <Overline className="block mb-2 text-muted-foreground">Browse catalog</Overline>
            <div className="mb-3 rounded-lg bg-surface-ink p-3 text-on-ink">
              <Lead>{tools.length} tools</Lead>
              <Caption className="block mt-1 text-on-ink-muted">
                {counts.visible} visible · {counts.hidden} hidden
              </Caption>
            </div>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              <RailItem
                active={appFilter === "all" && visibility === "all"}
                count={tools.length}
                icon={LayoutGrid}
                label="All tools"
                onClick={() => selectApp("all")}
              />
              {GROUPS.map((group) => (
                <RailItem
                  active={appFilter === group.app}
                  count={tools.filter((tool) => tool.app === group.app).length}
                  icon={group.icon}
                  key={group.app}
                  label={group.title}
                  onClick={() => selectApp(group.app)}
                />
              ))}
            </div>
            <div className="my-3 h-px bg-border" />
            <Overline className="block mb-1 text-muted-foreground">Quick views</Overline>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              <RailItem
                active={visibility === "visible"}
                count={counts.visible}
                icon={Eye}
                label="Visible now"
                onClick={() => setVisibility(visibility === "visible" ? "all" : "visible")}
              />
              <RailItem
                active={visibility === "hidden"}
                count={counts.hidden}
                icon={EyeOff}
                label="Hidden"
                onClick={() => setVisibility(visibility === "hidden" ? "all" : "hidden")}
              />
              <RailItem
                active={visibility === "draft"}
                count={counts.draft}
                icon={Pencil}
                label="Drafts"
                onClick={() => setVisibility(visibility === "draft" ? "all" : "draft")}
              />
              <RailItem
                active={visibility === "setup"}
                count={counts.setup}
                icon={TriangleAlert}
                label="Setup required"
                onClick={() => setVisibility(visibility === "setup" ? "all" : "setup")}
              />
              <RailItem
                active={visibility === "archived"}
                count={counts.archived}
                icon={History}
                label="Archived"
                onClick={() => setVisibility(visibility === "archived" ? "all" : "archived")}
              />
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <H3 className="truncate">{resultsTitle}</H3>
                <Caption className="shrink-0 text-muted-foreground">{filteredTools.length} matches</Caption>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {availableCategories.length ? (
                  <Select
                    aria-label="Tool type"
                    className="w-52"
                    onChange={(event) =>
                      updateAdminQuery({
                        category: event.target.value === "all" ? null : event.target.value,
                        page: null,
                      })
                    }
                    size="sm"
                    value={categoryFilter}
                  >
                    <option value="all">All tool types</option>
                    {availableCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Caption className="hidden text-muted-foreground xl:inline">
                  {canReorder ? "Drag to set catalog order" : "Clear filters to reorder"}
                </Caption>
              </div>
            </div>

            <AdminListing
              className="rounded-none border-0 shadow-none"
              aria-label="Tools"
              pagination={{
                "aria-label": "Tool pages",
                page: pagination.page,
                pageCount: pagination.pageCount,
                onPageChange: (page) => setPage(String(page)),
                summary: `Showing ${pagination.start}–${pagination.end} of ${pagination.total} tools`,
              }}
            >
              {filteredTools.length ? (
                GROUPS.map((group) => {
                  const groupTools = filteredTools.filter((tool) => tool.app === group.app);
                  return groupTools.some((tool) => visibleIds.has(tool.id)) ? (
                    <ToolGroup
                      app={group.app}
                      canReorder={canReorder}
                      key={group.app}
                      title={group.title}
                      tools={groupTools}
                      publicSiteUrl={publicSiteUrl}
                      visibleIds={visibleIds}
                    />
                  ) : null;
                })
              ) : (
                <ContentState
                  className="min-h-full"
                  state="no-results"
                  icon={<Search />}
                  title="No matching tools"
                  description="Try a different search or clear the active filters."
                  action={
                    <Button onClick={resetFilters} type="button" variant="secondary">
                      Clear filters
                    </Button>
                  }
                />
              )}
            </AdminListing>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
