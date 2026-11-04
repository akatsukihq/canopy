"use client";

import { useAdminQueryState } from "@/app/admin/hooks/useAdminQueryState";

import {
  Caption,
  H3,
  Label,
  Muted,
  P,
  ActionMenuButton,
  AlertBanner,
  Button,
  DropdownMenuItem,
  Input,
  OrderableList,
  Select,
  StatusBadge,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
  type OrderableItemState,
} from "@/components/ui/index.tsx";
import { GripVertical, Plus, RotateCcw, Save, Search, Trash2, UploadCloud, X } from "lucide-react";
import {
  startTransition,
  useActionState,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { TOOL_CATEGORIES, type CategoryKey } from "../../../../../../lib/tool-framework/categories";
import { publishToolContentAction, saveToolContentAction, type ToolContentActionState } from "../../actions";
import { HeaderActions } from "./HeaderActions";

const IDLE: ToolContentActionState = { status: "idle", message: "" };

const CATEGORY_OPTIONS: readonly { key: CategoryKey; label: string }[] = Object.entries(TOOL_CATEGORIES).map(
  ([key, category]) => ({
    key: key as CategoryKey,
    label: `${category.label} · ${category.app}`,
  }),
);

export interface InheritedContentView {
  readonly category: string;
  readonly keywords: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly contentDoc: unknown;
}

export interface StoredContentView {
  readonly category: string | null;
  readonly keywords: readonly string[] | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly contentDoc: unknown;
  readonly published: boolean;
  readonly publishedAtLabel: string | null;
  readonly hasRow: boolean;
}

export interface ToolContentFormProps {
  readonly inherited: InheritedContentView;
  readonly relatedTools: readonly { readonly id: string; readonly name: string }[];
  readonly section: "catalog" | "content";
  /** Catalog only: whether saved content can be published, and the panel shown beside the fields. */
  readonly hasDraftContent?: boolean;
  readonly leading?: ReactNode;
  readonly stored: StoredContentView;
  readonly toolId: string;
}

type ContentRecord = {
  readonly howToUse: readonly string[];
  readonly limitations: readonly string[];
  readonly faq: readonly { readonly q: string; readonly a: string }[];
  readonly examples: readonly {
    readonly label: string;
    readonly text: string;
    readonly secondary?: string;
  }[];
  readonly relatedToolIds: readonly string[];
};

type TextItem = { readonly id: string; readonly value: string };
type FaqItem = { readonly id: string; readonly q: string; readonly a: string };
type ExampleItem = {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly secondary: string;
};

type DocumentSection = "howToUse" | "limitations" | "faq" | "examples" | "relatedToolIds";

const DOCUMENT_SECTIONS: readonly {
  readonly key: DocumentSection;
  readonly label: string;
}[] = [
  { key: "howToUse", label: "How to use" },
  { key: "limitations", label: "Limitations" },
  { key: "faq", label: "FAQ" },
  { key: "examples", label: "Examples" },
  { key: "relatedToolIds", label: "Related tools" },
];

let itemSequence = 0;
function itemId(prefix: string): string {
  itemSequence += 1;
  return `${prefix}-${itemSequence}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function contentRecord(value: unknown): ContentRecord {
  const record = asRecord(value);
  const faqValue = record?.faq;
  const examplesValue = record?.examples;
  const faq = Array.isArray(faqValue)
    ? faqValue.flatMap((entry) => {
        const item = asRecord(entry);
        return typeof item?.q === "string" && typeof item.a === "string" ? [{ q: item.q, a: item.a }] : [];
      })
    : [];
  const examples = Array.isArray(examplesValue)
    ? examplesValue.flatMap((entry) => {
        const item = asRecord(entry);
        return typeof item?.label === "string" && typeof item.text === "string"
          ? [
              {
                label: item.label,
                text: item.text,
                ...(typeof item.secondary === "string" ? { secondary: item.secondary } : {}),
              },
            ]
          : [];
      })
    : [];

  return {
    howToUse: strings(record?.howToUse),
    limitations: strings(record?.limitations),
    faq,
    examples,
    relatedToolIds: strings(record?.relatedToolIds),
  };
}

function HiddenDocument({ content, override }: { content: ContentRecord; override: boolean }) {
  return (
    <>
      <input name="contentDocMode" type="hidden" value={override ? "override" : "inherit"} />
      <input name="howToUse" type="hidden" value={content.howToUse.join("\n")} />
      <input name="limitations" type="hidden" value={content.limitations.join("\n")} />
      <input name="faq" type="hidden" value={JSON.stringify(content.faq)} />
      <input name="examples" type="hidden" value={JSON.stringify(content.examples)} />
      <input name="relatedToolIds" type="hidden" value={content.relatedToolIds.join("\n")} />
    </>
  );
}

function HiddenCatalog({ stored }: { stored: StoredContentView }) {
  return (
    <>
      <input name="category" type="hidden" value={stored.category ?? ""} />
      <input name="keywords" type="hidden" value={(stored.keywords ?? []).join(", ")} />
      <input name="seoTitle" type="hidden" value={stored.seoTitle ?? ""} />
      <input name="seoDescription" type="hidden" value={stored.seoDescription ?? ""} />
    </>
  );
}

function FieldHeader({
  count,
  defaultValue,
  htmlFor,
  label,
  onRevert,
  overridden,
}: {
  count?: string;
  defaultValue: string;
  htmlFor: string;
  label: string;
  onRevert: () => void;
  overridden: boolean;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      <span className="flex shrink-0 items-center gap-2">
        {count ? <Caption className="text-muted-foreground">{count}</Caption> : null}
        {overridden ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={`Revert ${label} to default`}
                onClick={onRevert}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RotateCcw aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal [overflow-wrap:anywhere]">
              <span className="block">Revert to default</span>
              <span className="mt-1 block font-normal">{defaultValue || "None"}</span>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    </div>
  );
}

function KeywordTagInput({
  describedBy,
  id,
  onChange,
  placeholder,
  values,
}: {
  describedBy: string;
  id: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: readonly string[];
}) {
  const [draft, setDraft] = useState("");

  function commitDraft(): void {
    const keyword = draft.trim().replace(/,$/, "");
    if (!keyword || values.length >= 24) {
      setDraft("");
      return;
    }
    if (!values.some((value) => value.toLowerCase() === keyword.toLowerCase())) {
      onChange([...values, keyword]);
    }
    setDraft("");
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      {values.map((keyword) => (
        <Caption
          className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-accent pr-0.5 pl-2.5 text-primary"
          key={keyword}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{keyword}</span>
          <Button
            aria-label={`Remove ${keyword}`}
            className="size-6 rounded-full text-muted-foreground"
            onClick={() => onChange(values.filter((value) => value !== keyword))}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-3" />
          </Button>
        </Caption>
      ))}
      <input
        aria-describedby={describedBy}
        aria-label="Add keyword"
        className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
        disabled={values.length >= 24}
        id={id}
        onBlur={commitDraft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        placeholder={values.length ? "Add keyword" : placeholder}
        value={draft}
      />
    </div>
  );
}

function CatalogForm({
  hasDraftContent = false,
  inherited,
  leading,
  stored,
  toolId,
}: Omit<ToolContentFormProps, "relatedTools" | "section">) {
  const formId = useId();
  const [, action, pending] = useActionState(async (previous: ToolContentActionState, data: FormData) => {
    const next = await saveToolContentAction(previous, data);
    if (next.status === "success") toast.success(next.message, { id: `${formId}-feedback` });
    if (next.status === "error") toast.error(next.message, { id: `${formId}-feedback` });
    return next;
  }, IDLE);
  const form = useRef<HTMLFormElement>(null);
  const [, publish, publishing] = useActionState(async (previous: ToolContentActionState, data: FormData) => {
    const next = await publishToolContentAction(previous, data);
    if (next.status === "success") toast.success(next.message);
    if (next.status === "error") toast.error(next.message);
    return next;
  }, IDLE);
  const busy = pending || publishing;
  function togglePublished(): void {
    const data = new FormData();
    data.set("toolId", toolId);
    data.set("published", String(!stored.published));
    startTransition(() => publish(data));
  }
  const [category, setCategory] = useState(stored.category ?? "");
  const [keywords, setKeywords] = useState<string[]>([...(stored.keywords ?? [])]);
  const [seoTitle, setSeoTitle] = useState(stored.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(stored.seoDescription ?? "");
  const storedDoc = contentRecord(stored.contentDoc ?? inherited.contentDoc);
  const inheritedCategory =
    CATEGORY_OPTIONS.find((option) => option.key === inherited.category)?.label ?? inherited.category;

  return (
    <TooltipProvider>
      <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        {leading ?? <div className="hidden md:block" />}
        <form action={action} aria-labelledby={`${formId}-heading`} className="contents" ref={form}>
          <input name="toolId" type="hidden" value={toolId} />
          <HiddenDocument content={storedDoc} override={asRecord(stored.contentDoc) !== null} />

          <div className="grid min-w-0 gap-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <H3 id={`${formId}-heading`}>Catalog &amp; SEO</H3>
                <StatusBadge variant={stored.published ? "success" : hasDraftContent ? "warning" : "neutral"}>
                  {stored.published ? "Published" : hasDraftContent ? "Draft" : "Default"}
                </StatusBadge>
              </div>
              <Muted className="mt-1" id={`${formId}-guidance`}>
                Blank fields use defaults.{" "}
                {stored.published ? "Saved changes go live immediately." : "Save, then publish to go live."}
              </Muted>
            </div>

            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <div className="grid min-w-0 content-start gap-1.5">
                <FieldHeader
                  defaultValue={inheritedCategory}
                  htmlFor={`${formId}-category`}
                  label="Category"
                  onRevert={() => setCategory("")}
                  overridden={Boolean(category)}
                />
                <Select
                  aria-describedby={`${formId}-guidance`}
                  id={`${formId}-category`}
                  name="category"
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  <option value="">Default: {inheritedCategory || "None"}</option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid min-w-0 content-start gap-1.5">
                <FieldHeader
                  count={`${keywords.length} / 24`}
                  defaultValue={inherited.keywords.join(", ")}
                  htmlFor={`${formId}-keywords`}
                  label="Keywords"
                  onRevert={() => setKeywords([])}
                  overridden={keywords.length > 0}
                />
                <input name="keywords" type="hidden" value={keywords.join(", ")} />
                <KeywordTagInput
                  describedBy={`${formId}-guidance ${formId}-keywords-help`}
                  id={`${formId}-keywords`}
                  onChange={setKeywords}
                  placeholder={inherited.keywords.join(", ") || "Add keyword, then press Enter"}
                  values={keywords}
                />
                <span className="sr-only" id={`${formId}-keywords-help`}>
                  Press Enter or comma to add a keyword.
                </span>
              </div>

              <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2">
                <FieldHeader
                  count={`${seoTitle.length} / 160`}
                  defaultValue={inherited.seoTitle}
                  htmlFor={`${formId}-seo-title`}
                  label="SEO title"
                  onRevert={() => setSeoTitle("")}
                  overridden={Boolean(seoTitle.trim())}
                />
                <Input
                  aria-describedby={`${formId}-guidance`}
                  id={`${formId}-seo-title`}
                  maxLength={160}
                  name="seoTitle"
                  onChange={(event) => setSeoTitle(event.target.value)}
                  placeholder={inherited.seoTitle || "Page title in search results"}
                  value={seoTitle}
                />
              </div>
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-1.5 md:col-span-2">
            <FieldHeader
              count={`${seoDescription.length} / 320`}
              defaultValue={inherited.seoDescription}
              htmlFor={`${formId}-seo-description`}
              label="SEO description"
              onRevert={() => setSeoDescription("")}
              overridden={Boolean(seoDescription.trim())}
            />
            <Textarea
              aria-describedby={`${formId}-guidance`}
              className="min-h-[76px] resize-y py-2 [field-sizing:fixed]"
              id={`${formId}-seo-description`}
              maxLength={320}
              name="seoDescription"
              onChange={(event) => setSeoDescription(event.target.value)}
              placeholder={inherited.seoDescription || "Summary shown in search results"}
              rows={3}
              value={seoDescription}
            />
          </div>
        </form>
        <HeaderActions>
          <ActionMenuButton
            disabled={busy}
            icon={<Save aria-hidden="true" />}
            label="Content actions"
            loading={busy}
            menuLabel="More content actions"
            primaryAction={{ label: "Save changes", onClick: () => form.current?.requestSubmit() }}
            size="sm"
          >
            <DropdownMenuItem disabled={!stored.published && !hasDraftContent} onSelect={togglePublished}>
              <UploadCloud aria-hidden="true" /> {stored.published ? "Return to draft" : "Publish saved content"}
            </DropdownMenuItem>
          </ActionMenuButton>
        </HeaderActions>
      </div>
    </TooltipProvider>
  );
}

function DragHandle({ label, state }: { label: string; state: OrderableItemState }) {
  return (
    <Button
      aria-label={`Reorder ${label}`}
      className="cursor-grab rounded-md text-muted-foreground active:cursor-grabbing"
      ref={state.setActivatorNodeRef}
      size="icon"
      type="button"
      variant="ghost"
      {...state.attributes}
      {...state.listeners}
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </Button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button aria-label={`Delete ${label}`} onClick={onClick} size="icon-sm" type="button" variant="ghost">
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

function TextListEditor({
  addLabel,
  description,
  items,
  label,
  onChange,
}: {
  addLabel: string;
  description: string;
  items: readonly TextItem[];
  label: string;
  onChange: (items: TextItem[]) => void;
}) {
  return (
    <div>
      <Muted className="mb-4 text-muted-foreground">{description}</Muted>
      <OrderableList
        ariaLabel={`${label} entries`}
        className="divide-y divide-border border-y border-border"
        getId={(item) => item.id}
        getLabel={(item) => item.value || label}
        items={items}
        onReorder={onChange}
        renderItem={(item, dragState) => {
          const index = items.findIndex((candidate) => candidate.id === item.id);
          return (
            <div
              className={`flex items-start gap-2 py-2 ${dragState.isDragging ? "bg-accent shadow-sm" : "bg-background"}`}
            >
              <DragHandle label={`${label} ${index + 1}`} state={dragState} />
              <Caption className="w-7 shrink-0 pt-2.5 text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </Caption>
              <Textarea
                aria-label={`${label} ${index + 1}`}
                className="min-h-11 flex-1 resize-y"
                onChange={(event) =>
                  onChange(
                    items.map((candidate) =>
                      candidate.id === item.id ? { ...candidate, value: event.target.value } : candidate,
                    ),
                  )
                }
                value={item.value}
              />
              <RemoveButton
                label={`${label} ${index + 1}`}
                onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              />
            </div>
          );
        }}
      />
      <Button
        className="mt-3"
        onClick={() => onChange([...items, { id: itemId(label), value: "" }])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}

function FaqEditor({ items, onChange }: { items: readonly FaqItem[]; onChange: (items: FaqItem[]) => void }) {
  return (
    <div>
      <Muted className="mb-4 text-muted-foreground">
        Each entry requires a question and answer. Drag entries to control public order.
      </Muted>
      <OrderableList
        ariaLabel="FAQ entries"
        className="divide-y divide-border border-y border-border"
        getId={(item) => item.id}
        getLabel={(item) => item.q || "FAQ entry"}
        items={items}
        onReorder={onChange}
        renderItem={(item, dragState) => {
          const index = items.findIndex((candidate) => candidate.id === item.id);
          return (
            <div
              className={`flex items-start gap-2 py-3 ${dragState.isDragging ? "bg-accent shadow-sm" : "bg-background"}`}
            >
              <DragHandle label={`FAQ ${index + 1}`} state={dragState} />
              <Caption className="w-7 shrink-0 pt-2.5 text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </Caption>
              <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <Input
                  aria-label={`FAQ ${index + 1} question`}
                  onChange={(event) =>
                    onChange(
                      items.map((candidate) =>
                        candidate.id === item.id ? { ...candidate, q: event.target.value } : candidate,
                      ),
                    )
                  }
                  placeholder="Question"
                  value={item.q}
                />
                <Textarea
                  aria-label={`FAQ ${index + 1} answer`}
                  className="min-h-20 resize-y"
                  onChange={(event) =>
                    onChange(
                      items.map((candidate) =>
                        candidate.id === item.id ? { ...candidate, a: event.target.value } : candidate,
                      ),
                    )
                  }
                  placeholder="Answer"
                  value={item.a}
                />
              </div>
              <RemoveButton
                label={`FAQ ${index + 1}`}
                onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              />
            </div>
          );
        }}
      />
      <Button
        className="mt-3"
        onClick={() => onChange([...items, { id: itemId("faq"), q: "", a: "" }])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" />
        Add question and answer
      </Button>
    </div>
  );
}

function ExamplesEditor({
  items,
  onChange,
}: {
  items: readonly ExampleItem[];
  onChange: (items: ExampleItem[]) => void;
}) {
  return (
    <div>
      <Muted className="mb-4 text-muted-foreground">
        Provide a label and primary sample. Secondary input is optional for two-input tools.
      </Muted>
      <OrderableList
        ariaLabel="Example entries"
        className="divide-y divide-border border-y border-border"
        getId={(item) => item.id}
        getLabel={(item) => item.label || "Example"}
        items={items}
        onReorder={onChange}
        renderItem={(item, dragState) => {
          const index = items.findIndex((candidate) => candidate.id === item.id);
          const update = (values: Partial<ExampleItem>) =>
            onChange(items.map((candidate) => (candidate.id === item.id ? { ...candidate, ...values } : candidate)));
          return (
            <div
              className={`flex items-start gap-2 py-3 ${dragState.isDragging ? "bg-accent shadow-sm" : "bg-background"}`}
            >
              <DragHandle label={`example ${index + 1}`} state={dragState} />
              <Caption className="w-7 shrink-0 pt-2.5 text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </Caption>
              <div className="grid min-w-0 flex-1 gap-2">
                <Input
                  aria-label={`Example ${index + 1} label`}
                  onChange={(event) => update({ label: event.target.value })}
                  placeholder="Example label"
                  value={item.label}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <Textarea
                    code
                    aria-label={`Example ${index + 1} primary sample`}
                    className="min-h-24"
                    onChange={(event) => update({ text: event.target.value })}
                    placeholder="Primary sample"
                    value={item.text}
                  />
                  <Textarea
                    code
                    aria-label={`Example ${index + 1} secondary sample`}
                    className="min-h-24"
                    onChange={(event) => update({ secondary: event.target.value })}
                    placeholder="Secondary sample (optional)"
                    value={item.secondary}
                  />
                </div>
              </div>
              <RemoveButton
                label={`example ${index + 1}`}
                onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              />
            </div>
          );
        }}
      />
      <Button
        className="mt-3"
        onClick={() => onChange([...items, { id: itemId("example"), label: "", text: "", secondary: "" }])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" />
        Add example
      </Button>
    </div>
  );
}

function RelatedToolsEditor({
  items,
  onChange,
  tools,
}: {
  items: readonly TextItem[];
  onChange: (items: TextItem[]) => void;
  tools: ToolContentFormProps["relatedTools"];
}) {
  const [query, setQuery] = useAdminQueryState<string>("relatedQuery", "");
  const selectedIds = new Set(items.map((item) => item.value));
  const matches = tools
    .filter(
      (tool) => !selectedIds.has(tool.id) && `${tool.name} ${tool.id}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 5);

  return (
    <div>
      <Muted className="mb-4 text-muted-foreground">
        Link stable tool IDs and order the recommendations visitors see next.
      </Muted>
      <div className="relative mb-3">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search tools"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value, true)}
          placeholder="Search by name or stable ID"
          value={query}
        />
      </div>
      {query ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {matches.length ? (
            matches.map((tool) => (
              <Button
                key={tool.id}
                onClick={() => {
                  onChange([...items, { id: itemId("related"), value: tool.id }]);
                  setQuery("");
                }}
                size="xs"
                type="button"
                variant="secondary"
              >
                <Plus aria-hidden="true" />
                {tool.name}
              </Button>
            ))
          ) : (
            <Caption className="text-muted-foreground">No unlinked tools match.</Caption>
          )}
        </div>
      ) : null}
      <OrderableList
        ariaLabel="Selected related tools"
        className="divide-y divide-border border-y border-border"
        getId={(item) => item.id}
        getLabel={(item) => item.value}
        items={items}
        onReorder={onChange}
        renderItem={(item, dragState) => {
          const tool = tools.find((candidate) => candidate.id === item.value);
          return (
            <div
              className={`flex items-center gap-2 py-2 ${dragState.isDragging ? "bg-accent shadow-sm" : "bg-background"}`}
            >
              <DragHandle label={tool?.name ?? item.value} state={dragState} />
              <div className="min-w-0 flex-1">
                <P className="truncate">{tool?.name ?? "Unknown tool"}</P>
                <Caption className="block truncate text-muted-foreground">{item.value}</Caption>
              </div>
              <RemoveButton
                label={tool?.name ?? item.value}
                onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              />
            </div>
          );
        }}
      />
    </div>
  );
}

function ContentDocumentForm({ inherited, relatedTools, stored, toolId }: Omit<ToolContentFormProps, "section">) {
  const formId = useId();
  const [state, action, pending] = useActionState(saveToolContentAction, IDLE);
  const inheritedDoc = contentRecord(inherited.contentDoc);
  const initialDoc = contentRecord(stored.contentDoc ?? inherited.contentDoc);
  const [overrideDoc, setOverrideDoc] = useState(asRecord(stored.contentDoc) !== null);
  const [activeSection, setActiveSection] = useAdminQueryState<DocumentSection>(
    "documentSection",
    "howToUse",
    DOCUMENT_SECTIONS.map((section) => section.key),
  );
  const [howToUse, setHowToUse] = useState<TextItem[]>(
    initialDoc.howToUse.map((value) => ({ id: itemId("how"), value })),
  );
  const [limitations, setLimitations] = useState<TextItem[]>(
    initialDoc.limitations.map((value) => ({ id: itemId("limitation"), value })),
  );
  const [faq, setFaq] = useState<FaqItem[]>(initialDoc.faq.map((item) => ({ id: itemId("faq"), ...item })));
  const [examples, setExamples] = useState<ExampleItem[]>(
    initialDoc.examples.map((item) => ({
      id: itemId("example"),
      label: item.label,
      text: item.text,
      secondary: item.secondary ?? "",
    })),
  );
  const [related, setRelated] = useState<TextItem[]>(
    initialDoc.relatedToolIds.map((value) => ({ id: itemId("related"), value })),
  );

  const current: ContentRecord = {
    howToUse: howToUse.map((item) => item.value),
    limitations: limitations.map((item) => item.value),
    faq: faq.map(({ q, a }) => ({ q, a })),
    examples: examples.map(({ label, text, secondary }) => ({
      label,
      text,
      ...(secondary.trim() ? { secondary } : {}),
    })),
    relatedToolIds: related.map((item) => item.value),
  };

  const sectionCounts = useMemo(
    () => ({
      howToUse: howToUse.length,
      limitations: limitations.length,
      faq: faq.length,
      examples: examples.length,
      relatedToolIds: related.length,
    }),
    [examples.length, faq.length, howToUse.length, limitations.length, related.length],
  );

  function restoreFromCode(): void {
    setHowToUse(inheritedDoc.howToUse.map((value) => ({ id: itemId("how"), value })));
    setLimitations(inheritedDoc.limitations.map((value) => ({ id: itemId("limitation"), value })));
    setFaq(inheritedDoc.faq.map((item) => ({ id: itemId("faq"), ...item })));
    setExamples(
      inheritedDoc.examples.map((item) => ({
        id: itemId("example"),
        label: item.label,
        text: item.text,
        secondary: item.secondary ?? "",
      })),
    );
    setRelated(inheritedDoc.relatedToolIds.map((value) => ({ id: itemId("related"), value })));
    setOverrideDoc(false);
  }

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-4" id={formId}>
      <input name="toolId" type="hidden" value={toolId} />
      <HiddenCatalog stored={stored} />
      <HiddenDocument content={current} override={overrideDoc} />

      <div className="flex shrink-0 items-center gap-2 border-b border-border pb-2 sm:items-end sm:justify-between sm:pb-4">
        <div className="hidden sm:block">
          <H3>Content document</H3>
          <Muted className="mt-1 text-muted-foreground">
            Edit the supporting content shown below the public tool workspace.
          </Muted>
        </div>
        <Button onClick={restoreFromCode} size="sm" type="button" variant="secondary">
          <RotateCcw aria-hidden="true" />
          Use code document
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-4 lg:flex-row lg:gap-6">
        <nav
          aria-label="Content document sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border pb-2 lg:w-[190px] lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-5"
        >
          {DOCUMENT_SECTIONS.map((section) => (
            <button
              aria-current={activeSection === section.key ? "page" : undefined}
              className={`flex min-h-10 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-left transition-colors ${activeSection === section.key ? "bg-accent text-primary" : "text-foreground hover:bg-muted"}`}
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              type="button"
            >
              <Caption>{section.label}</Caption>
              <Caption className="text-muted-foreground">{sectionCounts[section.key]}</Caption>
            </button>
          ))}
        </nav>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="hidden shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex">
            <H3>{DOCUMENT_SECTIONS.find((section) => section.key === activeSection)?.label}</H3>
            <Caption className="text-muted-foreground">Drag to reorder · changes save as one document</Caption>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {activeSection === "howToUse" ? (
              <TextListEditor
                addLabel="Add step"
                description="Write concise ordered steps that take a first-time visitor from input to result."
                items={howToUse}
                label="Step"
                onChange={(items) => {
                  setHowToUse(items);
                  setOverrideDoc(true);
                }}
              />
            ) : null}
            {activeSection === "limitations" ? (
              <TextListEditor
                addLabel="Add limitation"
                description="State boundaries plainly so visitors understand what the tool does not validate or guarantee."
                items={limitations}
                label="Limitation"
                onChange={(items) => {
                  setLimitations(items);
                  setOverrideDoc(true);
                }}
              />
            ) : null}
            {activeSection === "faq" ? (
              <FaqEditor
                items={faq}
                onChange={(items) => {
                  setFaq(items);
                  setOverrideDoc(true);
                }}
              />
            ) : null}
            {activeSection === "examples" ? (
              <ExamplesEditor
                items={examples}
                onChange={(items) => {
                  setExamples(items);
                  setOverrideDoc(true);
                }}
              />
            ) : null}
            {activeSection === "relatedToolIds" ? (
              <RelatedToolsEditor
                items={related}
                onChange={(items) => {
                  setRelated(items);
                  setOverrideDoc(true);
                }}
                tools={relatedTools}
              />
            ) : null}
          </div>
        </section>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-2 sm:pt-4">
        {state.status !== "idle" ? (
          <AlertBanner variant={state.status === "success" ? "success" : "error"}>{state.message}</AlertBanner>
        ) : null}
        <HeaderActions>
          <Button form={formId} loading={pending} onClick={() => setOverrideDoc(true)} size="sm" type="submit">
            <Save aria-hidden="true" /> {pending ? "Saving…" : "Save document"}
          </Button>
        </HeaderActions>
      </div>
    </form>
  );
}

export function ToolContentForm(props: ToolContentFormProps): ReactElement {
  return props.section === "catalog" ? (
    <CatalogForm
      hasDraftContent={props.hasDraftContent}
      inherited={props.inherited}
      leading={props.leading}
      stored={props.stored}
      toolId={props.toolId}
    />
  ) : (
    <ContentDocumentForm
      inherited={props.inherited}
      relatedTools={props.relatedTools}
      stored={props.stored}
      toolId={props.toolId}
    />
  );
}
