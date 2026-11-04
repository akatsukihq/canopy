"use client";

import { Fragment, useActionState, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide";
import { Braces, Filter, Search, X } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { CodeEditor, type CodeEditorHandle } from "@/components/content/CodeEditor.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Caption,
  ContentState,
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
  H3,
  Input,
  Muted,
  Select,
  StatusBadge,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@/components/ui/index.tsx";
import { direction, isLocale, localeLabels, locales, type Locale } from "@/lib/i18n/config.ts";
import {
  toolMessageTree,
  validateToolTranslation,
  type ToolMessages,
  type ToolTranslations,
} from "@/lib/tool-framework/translations.ts";
import { PlaceholderMenu } from "./PlaceholderMenu.tsx";
import { useAssistantTarget } from "./ToolAssistantContext.tsx";
import { saveToolTranslationAction, type ToolTranslationActionState } from "../../actions";

const PLACEHOLDER = /\{([A-Za-z_][\w.]*)\}/g;
const IDLE: ToolTranslationActionState = { status: "idle", message: "" };
const SECTIONS = {
  details: "Tool details",
  inputs: "Inputs & settings",
  messages: "Messages & results",
  content: "Page content",
  seo: "Search & SEO",
};
const SECTION_DESCRIPTIONS = {
  details: "The name and description people see when browsing tools.",
  inputs: "Labels, help text, and choices shown in the tool's controls.",
  messages: "Instructions, results, and feedback shown while using the tool.",
  content: "Steps, examples, and answers that help people use the tool.",
  seo: "The text used in search results and tool discovery.",
};

function messageSection(key: string): keyof typeof SECTIONS {
  if (key === "name" || key === "description") return "details";
  if (/^(input|settings|optionsPanel|trigger)\./.test(key)) return "inputs";
  if (key.startsWith("content.")) return "content";
  if (key.startsWith("seo") || key.startsWith("keywords.")) return "seo";
  return "messages";
}

function messageLabel(key: string): string {
  const labels: Record<string, string> = {
    name: "Tool name",
    description: "Short description",
    seoTitle: "Search result title",
    seoDescription: "Search result description",
    "input.label": "Input label",
    "input.placeholder": "Input placeholder",
    "input.dropzoneDescription": "Upload instructions",
    "trigger.actionLabel": "Run button",
    "labels.empty": "Before input",
    "labels.ready": "Ready message",
    "labels.running": "Processing message",
    "labels.result": "Result heading",
  };
  if (Object.hasOwn(labels, key)) return labels[key]!;
  return key
    .replace(
      /^(content\.(?:howToUse|faq|examples|limitations)|keywords)\.(\d+)/,
      (_, prefix, index) => `${prefix}.${Number(index) + 1}`,
    )
    .replace(/^runtime\./, "")
    .replace(/^settings\./, "")
    .replace(/\.choices\./, ".option.")
    .replace(/(\.option\..+)\.label$/, "$1")
    .replace(/\.help$/, ".help text")
    .replace(/^content\.howToUse\./, "Step.")
    .replace(/^content\.faq\./, "FAQ.")
    .replace(/^content\./, "")
    .replace(/\.q$/, ".question")
    .replace(/\.a$/, ".answer")
    .split(".")
    .map((part) => {
      try {
        part = decodeURIComponent(part);
      } catch {
        /* Keep an unfamiliar key readable. */
      }
      const words = part.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(" · ");
}

type MessageGroup = {
  path: string;
  segment: string;
  messageKey?: string;
  children: MessageGroup[];
};

function groupMessages(keys: Iterable<string>): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const key of keys) {
    const parts = key.split(".");
    let children = groups;
    // These namespaces are already described by the section navigation.
    const start = ["content", "settings", "runtime"].includes(parts[0]!) && parts.length > 1 ? 1 : 0;
    for (let index = start; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join(".");
      let group = children.find((entry) => entry.path === path);
      if (!group) {
        group = { path, segment: parts[index]!, children: [] };
        children.push(group);
      }
      if (index === parts.length - 1) group.messageKey = key;
      children = group.children;
    }
  }
  return groups;
}

function groupLabel(path: string, source: ToolMessages): string {
  const labels: Record<string, string> = {
    "content.howToUse": "How to use",
    "content.faq": "FAQs",
    "content.examples": "Examples",
    "content.limitations": "Limitations",
    keywords: "Keywords",
  };
  if (Object.hasOwn(labels, path)) return labels[path]!;
  if ((path.startsWith("settings.") || path.startsWith("input.fields.")) && source[`${path}.label`])
    return source[`${path}.label`]!;
  return messageLabel(path.split(".").at(-1)!);
}

function isMessageBranch(group: MessageGroup): boolean {
  return (
    group.children.length > 0 &&
    group.segment !== "choices" &&
    !group.children.every((child) => /^\d+$/.test(child.segment)) &&
    !group.path.includes(".choices.")
  );
}

function fieldLabel(key: string): string {
  if (!key.includes(".")) return messageLabel(key);
  const part = key.split(".").at(-1)!;
  const labels: Record<string, string> = { q: "Question", a: "Answer", help: "Help text", detail: "Description" };
  return Object.hasOwn(labels, part) ? labels[part]! : messageLabel(part);
}

function TranslationJsonDialog({
  locale,
  translations,
  englishMessages,
  disabled,
  onApply,
}: {
  locale: Locale;
  translations: ToolTranslations;
  englishMessages: ToolMessages;
  disabled: boolean;
  onApply: (locale: Locale, messages: Partial<Record<Locale, ToolMessages>>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingLocale, setEditingLocale] = useState(locale);
  const [edits, setEdits] = useState<Partial<Record<Locale, string>>>({});
  const [error, setError] = useState("");

  function initialJson(language: Locale) {
    return JSON.stringify(
      toolMessageTree(
        Object.fromEntries(
          Object.keys(englishMessages).map((key) => [key, translations[language]?.messages[key] ?? ""]),
        ),
      ),
      null,
      2,
    );
  }

  function flattenJsonMessages(value: unknown): ToolMessages {
    const branches = new Set(["", "runtime"]);
    for (const key of Object.keys(englishMessages)) {
      const parts = key.split(".");
      for (let index = 1; index < parts.length; index++) branches.add(parts.slice(0, index).join("."));
    }
    const messages: ToolMessages = Object.create(null);
    const pending = [{ value, path: "" }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (entry.path && typeof entry.value === "string") {
        messages[entry.path] = entry.value;
        continue;
      }
      if (!entry.value || typeof entry.value !== "object" || Array.isArray(entry.value))
        throw new Error(`${entry.path || "Messages"}: Use nested objects for groups and text for message values.`);
      if (!branches.has(entry.path)) throw new Error(`Unknown message group: ${entry.path}.`);
      for (const [part, child] of Object.entries(entry.value)) {
        if (!part || part.includes("."))
          throw new Error("Keep keys nested in their original groups; do not use dotted keys.");
        pending.push({ value: child, path: entry.path ? `${entry.path}.${part}` : part });
      }
    }
    return messages;
  }
  const changedLanguages = locales.filter(
    (language) => edits[language] !== undefined && edits[language] !== initialJson(language),
  );

  function showError(language: Locale, message: string) {
    setEditingLocale(language);
    setError(message);
  }

  function apply() {
    if (disabled || !changedLanguages.length) return;
    const updates: Partial<Record<Locale, ToolMessages>> = {};
    for (const language of changedLanguages) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(edits[language]!);
      } catch {
        showError(language, "Invalid JSON. Check double quotes, commas, and brackets.");
        return;
      }
      let messages: ToolMessages;
      try {
        messages = flattenJsonMessages(parsed);
      } catch (error) {
        showError(language, error instanceof Error ? error.message : "Invalid message structure.");
        return;
      }
      const issues = validateToolTranslation(language, messages, englishMessages, { publish: false });
      if (issues.length) {
        showError(language, `${issues[0]!.key}: ${issues[0]!.message}`);
        return;
      }
      const missingKey = Object.keys(englishMessages).find((key) => !Object.hasOwn(messages, key));
      if (missingKey) {
        showError(language, `Missing key: ${missingKey}. Keep every key; use an empty string for untranslated text.`);
        return;
      }
      updates[language] = messages;
    }
    onApply(editingLocale, updates);
    setOpen(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const overlappingKey = Object.keys(englishMessages).some((key) =>
            key
              .split(".")
              .some((_, index, parts) => index > 0 && Object.hasOwn(englishMessages, parts.slice(0, index).join("."))),
          );
          if (overlappingKey) {
            toast.error("Some message keys overlap. Resolve the conflicting keys before editing nested JSON.");
            return;
          }
          setEditingLocale(locale);
          setEdits({});
          setError("");
        }
        setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} variant="secondary" size="sm" type="button">
          <Braces aria-hidden="true" /> Raw JSON
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        role="dialog"
        aria-label="Raw JSON translations"
        aria-describedby="translation-json-help"
        className="flex h-[min(52rem,calc(100dvh-4rem))] w-[calc(100%-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-6xl"
      >
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-4 sm:grid-cols-[minmax(0,1fr)_16rem_auto] sm:px-6">
          <div className="min-w-0">
            <AlertDialogTitle>Raw JSON</AlertDialogTitle>
            <AlertDialogDescription id="translation-json-help" className="mt-1">
              Edit text values across all sections. Keep the nested structure, keys, and {"{placeholders}"} unchanged.
            </AlertDialogDescription>
          </div>
          <Field
            className="col-span-2 row-start-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-center"
            htmlFor="translation-json-language"
            label="Language"
          >
            <Select
              disabled={disabled}
              id="translation-json-language"
              value={editingLocale}
              onChange={(event) => {
                if (isLocale(event.target.value)) {
                  setEditingLocale(event.target.value);
                  setError("");
                }
              }}
            >
              {locales.map((language) => (
                <option key={language} value={language}>
                  {localeLabels[language]}
                </option>
              ))}
            </Select>
          </Field>
          <AlertDialogCancel
            className="col-start-2 row-start-1 sm:col-start-3"
            aria-label="Close JSON editor"
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </AlertDialogCancel>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            key={editingLocale}
            aria-label="Translation JSON"
            aria-describedby={error ? "translation-json-error" : "translation-json-help"}
            aria-invalid={Boolean(error)}
            disabled={disabled}
            language="json"
            value={open ? (edits[editingLocale] ?? initialJson(editingLocale)) : ""}
            wrap="soft"
            onChange={(value) => {
              setEdits((previous) => ({ ...previous, [editingLocale]: value }));
              setError("");
            }}
          />
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1 basis-64">
            {error ? (
              <p
                id="translation-json-error"
                role="alert"
                className="mb-1 max-h-24 overflow-y-auto break-words text-sm text-validation"
              >
                {error}
              </p>
            ) : null}
            <Caption className="text-muted-foreground">
              Apply updates edited languages in the form. Save or publish each language afterwards.
            </Caption>
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <AlertDialogCancel type="button" variant="secondary">
              Cancel
            </AlertDialogCancel>
            <Button type="button" disabled={disabled || !changedLanguages.length} onClick={apply}>
              Apply changes
            </Button>
          </div>
        </footer>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TranslationFields({
  toolId,
  locale,
  englishMessages,
  messages,
  translations,
  updatedAt,
  enabled,
  savedStatus,
  dirty,
  languageControl,
  onChange,
  onReplace,
  onSaved,
  onPendingChange,
}: {
  toolId: string;
  locale: Locale;
  englishMessages: ToolMessages;
  messages: ToolMessages;
  translations: ToolTranslations;
  updatedAt: string;
  enabled: boolean;
  savedStatus: "draft" | "published";
  dirty: boolean;
  languageControl: ReactNode;
  onChange: (key: string, value: string) => void;
  onReplace: (locale: Locale, messages: Partial<Record<Locale, ToolMessages>>) => void;
  onSaved: (updatedAt: string, status: "draft" | "published", sourceChanged: boolean) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, action, pending] = useActionState(saveToolTranslationAction, IDLE);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Set<string> | null>(null);
  const [section, setSection] = useState<keyof typeof SECTIONS>("details");
  const [selectedGroupPath, setSelectedGroupPath] = useState<string | null>(null);
  const [expandedNavigation, setExpandedNavigation] = useState<Set<string>>(new Set());
  const [focusedNavigation, setFocusedNavigation] = useState("section:details");
  // Keep the filtered worklist stable while someone fills a missing translation.
  const [untranslated, setUntranslated] = useState<Set<string> | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const form = useRef<HTMLFormElement>(null);
  const fieldsPane = useRef<HTMLDivElement>(null);
  const fieldsBody = useRef<HTMLDivElement>(null);
  const chipEditors = useRef(new Map<string, CodeEditorHandle>());
  const entries = Object.entries(englishMessages);
  const messageGroups = groupMessages(
    entries.filter(([key]) => messageSection(key) === "messages").map(([key]) => key),
  );
  const navigationGroups = messageGroups.flatMap(function branches(group): MessageGroup[] {
    return isMessageBranch(group) ? [group, ...group.children.flatMap(branches)] : [];
  });
  const selectedGroup = navigationGroups.find((group) => group.path === selectedGroupPath);
  const availableSections = (Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).filter((id) =>
    entries.some(([key]) => messageSection(key) === id),
  );
  const missing = entries.filter(([key]) => !messages[key]?.trim()).length;
  const errors = new Map(state.issues?.map((issue) => [issue.key, issue.message]));
  const query = search.trim().toLowerCase();
  const filtered = Boolean(query || untranslated);
  const visible = new Set(
    entries
      .filter(
        ([key]) =>
          (filtered || messageSection(key) === section) &&
          (filtered || !selectedGroup || key === selectedGroup.path || key.startsWith(`${selectedGroup.path}.`)) &&
          (!untranslated || untranslated.has(key)) &&
          (!searchResults || searchResults.has(key)),
      )
      .map(([key]) => key),
  );

  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      if (state.updatedAt && state.translationStatus)
        onSaved(state.updatedAt, state.translationStatus, Boolean(state.sourceChanged));
    } else if (state.status === "error") {
      toast.error(state.message);
      const firstIssue = state.issues?.find((issue) => Object.hasOwn(englishMessages, issue.key));
      if (firstIssue) {
        setSearch("");
        setSearchResults(null);
        setUntranslated(null);
        const issueSection = messageSection(firstIssue.key);
        const issueGroups = navigationGroups.filter(
          (group) => firstIssue.key === group.path || firstIssue.key.startsWith(`${group.path}.`),
        );
        const issueGroup = issueGroups.at(-1);
        setSection(issueSection);
        setSelectedGroupPath(issueGroup?.path ?? null);
        setFocusedNavigation(issueGroup ? `group:${issueGroup.path}` : `section:${issueSection}`);
        setExpandedNavigation(
          (current) =>
            new Set([...current, `section:${issueSection}`, ...issueGroups.map((group) => `group:${group.path}`)]),
        );
        setExpandedGroups((current) => {
          const next = new Set(current);
          const parts = firstIssue.key.split(".");
          for (let index = 1; index <= parts.length; index++) next.add(parts.slice(0, index).join("."));
          return next;
        });
        setFocusKey(firstIssue.key);
      }
    }
  }, [state]); // The action response owns this notification, not subsequent local edits.

  useEffect(() => {
    if (fieldsPane.current) fieldsPane.current.scrollTop = 0;
    if (fieldsBody.current) fieldsBody.current.scrollTop = 0;
  }, [section, selectedGroupPath]);

  useEffect(() => {
    if (!focusKey) return;
    const chipEditor = chipEditors.current.get(focusKey);
    if (chipEditor) {
      chipEditor.focus();
      setFocusKey(null);
      return;
    }
    const field = form.current?.elements.namedItem(`message:${focusKey}`);
    if (field instanceof HTMLElement) field.focus();
    setFocusKey(null);
  }, [focusKey]);

  function toggleNavigation(id: string) {
    setExpandedNavigation((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleNavigationKey(event: KeyboardEvent<HTMLButtonElement>) {
    const item = event.currentTarget;
    const items = [...(item.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(item);
    const expanded = item.getAttribute("aria-expanded");
    const id = item.dataset.treeId!;
    let target: HTMLButtonElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        target = items[index + 1];
        break;
      case "ArrowUp":
        target = items[index - 1];
        break;
      case "Home":
        target = items[0];
        break;
      case "End":
        target = items.at(-1);
        break;
      case "ArrowRight":
        if (expanded === "false") toggleNavigation(id);
        else if (expanded === "true") target = items[index + 1];
        break;
      case "ArrowLeft":
        if (expanded === "true") toggleNavigation(id);
        else target = items.find((candidate) => candidate.dataset.treeId === item.dataset.parentId);
        break;
      case "Enter":
      case " ":
        item.click();
        break;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }

  function renderNavigationItem(
    itemSection: keyof typeof SECTIONS,
    group: MessageGroup | undefined,
    index: number,
    total: number,
    depth = 0,
    parentId?: string,
  ): ReactNode {
    const id = group ? `group:${group.path}` : `section:${itemSection}`;
    const label = group ? groupLabel(group.path, englishMessages) : SECTIONS[itemSection];
    const accessibleLabel = group ? messageLabel(group.path) : label;
    const children = (group ? group.children : itemSection === "messages" ? messageGroups : []).filter(isMessageBranch);
    const expanded = expandedNavigation.has(id);
    const active = section === itemSection && (group ? selectedGroupPath === group.path : !selectedGroup);
    const keys = entries.filter(([key]) =>
      group ? key === group.path || key.startsWith(`${group.path}.`) : messageSection(key) === itemSection,
    );
    const complete = keys.filter(([key]) => messages[key]?.trim()).length;
    const icon = children.length ? (expanded ? FolderOpen : Folder) : FileText;
    return (
      <Fragment key={id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={accessibleLabel}
              aria-selected={!filtered && active}
              aria-expanded={children.length ? expanded : undefined}
              aria-level={depth + 1}
              aria-posinset={index + 1}
              aria-setsize={total}
              className="relative h-8 w-full justify-start gap-1.5 rounded-none px-2 font-normal text-muted-foreground hover:bg-muted/70 aria-selected:bg-primary/10 aria-selected:text-primary focus-visible:ring-inset focus-visible:ring-offset-0"
              data-parent-id={parentId}
              data-tree-id={id}
              onClick={() => {
                setSection(itemSection);
                setSelectedGroupPath(group?.path ?? null);
                setFocusedNavigation(id);
                setSearch("");
                setSearchResults(null);
                setUntranslated(null);
                if (children.length) toggleNavigation(id);
              }}
              onFocus={() => setFocusedNavigation(id)}
              onKeyDown={handleNavigationKey}
              role="treeitem"
              style={{ paddingInlineStart: 8 + depth * 14 }}
              tabIndex={focusedNavigation === id ? 0 : -1}
              variant="ghost"
            >
              {Array.from({ length: depth }, (_, level) => (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 border-l border-border/70"
                  key={level}
                  style={{ insetInlineStart: 14 + level * 14 }}
                />
              ))}
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center"
                onClick={
                  children.length
                    ? (event) => {
                        event.stopPropagation();
                        toggleNavigation(id);
                        event.currentTarget.closest("button")?.focus();
                      }
                    : undefined
                }
              >
                {children.length ? (
                  <MorphIcon
                    icon={expanded ? ChevronDown : ChevronRight}
                    reducedMotion="user"
                    size={12}
                    className="size-3"
                  />
                ) : null}
              </span>
              <MorphIcon icon={icon} reducedMotion="user" size={14} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <span
                className="shrink-0 text-xs tabular-nums text-muted-foreground"
                aria-label={`${complete} of ${keys.length} complete`}
              >
                {complete}/{keys.length}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{accessibleLabel}</TooltipContent>
        </Tooltip>
        {expanded
          ? children.map((child, childIndex) =>
              renderNavigationItem(itemSection, child, childIndex, children.length, depth + 1, id),
            )
          : null}
      </Fragment>
    );
  }

  function renderMessage(key: string, label = fieldLabel(key), hideLabel = false, stacked = false): ReactNode {
    const source = englishMessages[key]!;
    const id = `translation-${encodeURIComponent(key)}`;
    const placeholders = [...new Set(Array.from(source.matchAll(PLACEHOLDER), (match) => match[1]!))].sort();
    const describedBy =
      [locale !== "en" ? `${id}-source` : "", source.includes("{") ? "translation-variables" : ""]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className={locale === "en" ? "min-w-0" : "grid min-w-0 gap-2 md:grid-cols-2 md:gap-x-6"}>
        {locale !== "en" && !hideLabel ? (
          <Caption className="font-medium text-foreground md:col-span-2">{label}</Caption>
        ) : null}
        {locale !== "en" ? (
          <div className="min-w-0">
            <Caption className="mb-1 block text-muted-foreground md:hidden">English · reference</Caption>
            <p
              className="rounded-md bg-muted/40 px-3 py-2 whitespace-pre-wrap break-words text-sm text-muted-foreground"
              dir="ltr"
              id={`${id}-source`}
              lang="en"
            >
              {source}
            </p>
          </div>
        ) : null}
        <Field
          className={
            hideLabel || locale !== "en"
              ? locale === "en"
                ? "[&>[data-slot=field-label]]:sr-only"
                : "md:[&>[data-slot=field-label]]:sr-only"
              : stacked
                ? undefined
                : "md:grid md:grid-cols-[8rem_minmax(0,1fr)] md:gap-x-4 md:[&>[data-slot=field-label]]:pt-2.5 md:[&>[data-slot=field-error]]:col-start-2"
          }
          error={errors.get(key)}
          htmlFor={id}
          label={
            locale === "en" && !hideLabel ? (
              label
            ) : (
              <>
                <span className="sr-only">{messageLabel(key)} · </span>
                Translation
              </>
            )
          }
        >
          {placeholders.length ? (
            <div className="flex min-w-0 flex-col gap-1.5" dir={direction(locale)} lang={locale}>
              <PlaceholderMenu
                allowCustom={false}
                names={placeholders}
                onInsert={(name) => chipEditors.current.get(key)?.insertText(`{${name}}`)}
              />
              <CodeEditor
                // Field links its error to its direct child (this wrapper), so link it to the editor here.
                aria-describedby={
                  [describedBy, errors.get(key) ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined
                }
                aria-invalid={Boolean(errors.get(key))}
                className="h-auto min-h-16 rounded-md border border-input"
                disabled={pending}
                editorRef={(handle) => {
                  if (handle) chipEditors.current.set(key, handle);
                  else chipEditors.current.delete(key);
                }}
                id={id}
                language="text"
                onChange={(value) => onChange(key, value)}
                placeholder={locale === "en" ? undefined : "Enter translation"}
                placeholderChips
                value={messages[key] ?? ""}
                wrap="soft"
              />
              <input name={`message:${key}`} type="hidden" value={messages[key] ?? ""} />
            </div>
          ) : (
            <Textarea
              aria-describedby={describedBy}
              className={locale === "en" ? "min-h-9 py-2" : "min-h-9 flex-1 py-2"}
              disabled={pending}
              dir={direction(locale)}
              id={id}
              lang={locale}
              name={`message:${key}`}
              onChange={(event) => onChange(key, event.target.value)}
              placeholder={locale === "en" ? undefined : "Enter translation"}
              rows={1}
              value={messages[key] ?? ""}
            />
          )}
        </Field>
      </div>
    );
  }

  function renderGroup(group: MessageGroup, itemNumber?: number, stacked = false, expanded = false): ReactNode {
    if (!group.children.length && group.messageKey)
      return renderMessage(group.messageKey, undefined, itemNumber !== undefined, stacked);
    // A choice with only a label needs one editor, not another nested heading.
    if (
      !group.messageKey &&
      group.path.includes(".choices.") &&
      group.children.length === 1 &&
      group.children[0]?.segment === "label" &&
      group.children[0].messageKey &&
      group.children[0].children.length === 0
    )
      return renderMessage(group.children[0].messageKey!, groupLabel(group.path, englishMessages));

    const choices = group.segment === "choices";
    const array = !choices && group.children.every((child) => /^\d+$/.test(child.segment));
    const children = array
      ? [...group.children].sort((a, b) => Number(a.segment) - Number(b.segment))
      : /^content\.faq\.\d+$/.test(group.path)
        ? [...group.children].sort((a, b) => Number(a.segment === "a") - Number(b.segment === "a"))
        : group.children;
    const caption = itemNumber === undefined ? groupLabel(group.path, englishMessages) : `Item ${itemNumber}`;
    if (!expanded && !filtered && section === "messages" && isMessageBranch(group) && itemNumber === undefined) {
      const keys = [...visible].filter((key) => key === group.path || key.startsWith(`${group.path}.`));
      const complete = keys.filter((key) => messages[key]?.trim()).length;
      const open = expandedGroups.has(group.path);
      return (
        <Accordion
          collapsible
          type="single"
          value={open ? group.path : ""}
          onValueChange={(value) =>
            setExpandedGroups((current) => {
              const next = new Set(current);
              if (value) next.add(group.path);
              else next.delete(group.path);
              return next;
            })
          }
        >
          <AccordionItem className="border-0" value={group.path}>
            <AccordionTrigger className="gap-3 px-2 py-2.5 hover:bg-muted/50 hover:no-underline">
              <span className="min-w-0 flex-1 break-words">{caption}</span>
              <Caption className="shrink-0 tabular-nums text-muted-foreground">
                {complete}/{keys.length}
                <span className="sr-only"> fields complete</span>
              </Caption>
            </AccordionTrigger>
            <AccordionContent className="pt-3 pb-2 pl-3">
              {open ? renderGroup(group, itemNumber, stacked, true) : null}
            </AccordionContent>
            {!open
              ? keys.map((key) => <input key={key} name={`message:${key}`} type="hidden" value={messages[key] ?? ""} />)
              : null}
          </AccordionItem>
        </Accordion>
      );
    }
    const pairedFields =
      locale === "en" &&
      children.some((child) => child.segment === "label" && !child.children.length) &&
      children.some((child) => ["help", "detail"].includes(child.segment) && !child.children.length);
    return (
      <div className={pairedFields ? "grid min-w-0 gap-2 lg:grid-cols-[7rem_minmax(0,1fr)] lg:gap-4" : "min-w-0"}>
        {pairedFields ? (
          <p aria-hidden="true" className="text-sm font-medium lg:pt-7">
            {caption}
          </p>
        ) : null}
        <FieldSet className="min-w-0 gap-3">
          <FieldLegend className={itemNumber === undefined && !pairedFields && !expanded ? "mb-3 text-sm" : "sr-only"}>
            {caption}
          </FieldLegend>
          {group.messageKey ? renderMessage(group.messageKey) : null}
          {array ? (
            <ol aria-label={caption} role="list" className="grid gap-4">
              {children.map((child) => (
                <li
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2"
                  key={child.path}
                  value={Number(child.segment) + 1}
                >
                  <span aria-hidden="true" className="pt-2 text-sm tabular-nums text-muted-foreground">
                    {Number(child.segment) + 1}.
                  </span>
                  <div className="min-w-0">{renderGroup(child, Number(child.segment) + 1)}</div>
                </li>
              ))}
            </ol>
          ) : choices ? (
            <ul aria-label={caption} className="list-disc space-y-3 pl-5 marker:text-muted-foreground">
              {children.map((child) => (
                <li className="pl-1" key={child.path}>
                  {renderGroup(child)}
                </li>
              ))}
            </ul>
          ) : (
            <div
              className={
                pairedFields
                  ? "grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                  : expanded
                    ? "grid gap-3"
                    : "grid gap-3 pl-3"
              }
            >
              {children.map((child) => (
                <div
                  className={
                    pairedFields && (child.children.length > 0 || !["label", "help", "detail"].includes(child.segment))
                      ? "min-w-0 lg:col-span-2"
                      : "min-w-0"
                  }
                  key={child.path}
                >
                  {renderGroup(child, undefined, pairedFields)}
                </div>
              ))}
            </div>
          )}
        </FieldSet>
      </div>
    );
  }

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col gap-3" ref={form}>
      <input name="toolId" type="hidden" value={toolId} />
      <input name="locale" type="hidden" value={locale} />
      <input name="updatedAt" type="hidden" value={updatedAt} />
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-6 lg:overflow-hidden"
        ref={fieldsPane}
      >
        <aside className="flex min-h-0 min-w-0 shrink-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 items-end gap-3 lg:grid-cols-1">
            {languageControl}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge variant={savedStatus === "published" ? "success" : "warning"}>
                {savedStatus === "published" ? "Published" : "Draft · not live"}
              </StatusBadge>
              <Caption className="w-full text-muted-foreground" aria-live="polite">
                {entries.length - missing} / {entries.length} fields complete
                {missing ? ` · ${missing} untranslated` : ""}
              </Caption>
            </div>
          </div>
          <nav
            aria-label="Translation sections"
            className="max-h-48 min-h-0 shrink-0 overflow-y-auto overscroll-contain lg:max-h-none lg:shrink"
          >
            <TooltipProvider>
              <div role="tree" aria-label="Translation sections">
                {availableSections.map((id, index) =>
                  renderNavigationItem(id, undefined, index, availableSections.length),
                )}
              </div>
            </TooltipProvider>
          </nav>
        </aside>
        <section
          aria-label="Translation fields"
          className="flex min-h-0 min-w-0 shrink-0 flex-col lg:overflow-hidden lg:border-l lg:border-border lg:pl-6"
        >
          <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <H3>
                {filtered
                  ? "Search & filter results"
                  : selectedGroup
                    ? messageLabel(selectedGroup.path)
                    : SECTIONS[section]}
              </H3>
              <Muted className="mt-1 text-sm">
                {filtered
                  ? "Matching text from across this tool."
                  : selectedGroup
                    ? `Messages & results · ${groupLabel(selectedGroup.path, englishMessages)}`
                    : SECTION_DESCRIPTIONS[section]}
              </Muted>
            </div>
            <div className="flex items-center gap-3">
              <Caption className="text-muted-foreground" role="status">
                {visible.size} {visible.size === 1 ? "field" : "fields"}
              </Caption>
              <TranslationJsonDialog
                locale={locale}
                translations={translations}
                englishMessages={englishMessages}
                disabled={pending}
                onApply={onReplace}
              />
            </div>
          </div>
          <div className="mb-3 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="min-w-0">
              <FieldLabel className="sr-only" htmlFor="translation-search">
                Search translations
              </FieldLabel>
              <Input
                id="translation-search"
                leadingIcon={<Search />}
                onChange={(event) => {
                  const value = event.target.value.trim().toLowerCase();
                  setSearch(event.target.value);
                  setSearchResults(
                    value
                      ? new Set(
                          entries
                            .filter(([key, source]) =>
                              `${messageLabel(key)} ${key} ${source} ${messages[key] ?? ""} ${key
                                .split(".")
                                .map((_, index, parts) =>
                                  groupLabel(parts.slice(0, index + 1).join("."), englishMessages),
                                )
                                .join(" ")}`
                                .toLowerCase()
                                .includes(value),
                            )
                            .map(([key]) => key),
                        )
                      : null,
                  );
                }}
                placeholder="Search all translations…"
                type="search"
                value={search}
              />
            </div>
            <Button
              aria-pressed={untranslated !== null}
              className="font-medium text-muted-foreground aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/15"
              onClick={() =>
                setUntranslated((current) =>
                  current ? null : new Set(entries.filter(([key]) => !messages[key]?.trim()).map(([key]) => key)),
                )
              }
              variant="secondary"
            >
              <Filter aria-hidden="true" />
              Untranslated
            </Button>
          </div>
          <div
            className="shrink-0 pr-2 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto lg:overscroll-contain"
            ref={fieldsBody}
          >
            {[...visible].some((key) => englishMessages[key]?.includes("{")) ? (
              <Caption id="translation-variables" className="mb-4 block text-muted-foreground">
                Keep variable names inside {"{braces}"} and plural rules unchanged. Translate the text in each form.
              </Caption>
            ) : null}
            {locale !== "en" && visible.size > 0 ? (
              <div className="mb-3 hidden grid-cols-2 gap-6 md:grid">
                <Caption className="text-muted-foreground">English · reference</Caption>
                <Caption className="text-muted-foreground">Translation</Caption>
              </div>
            ) : null}
            {entries
              .filter(([key]) => !visible.has(key))
              .map(([key]) => (
                <input key={key} name={`message:${key}`} type="hidden" value={messages[key] ?? ""} />
              ))}
            <div className="grid gap-3">
              {(selectedGroup && !filtered ? [selectedGroup] : groupMessages(visible)).map((group) => (
                <div className="min-w-0" key={group.path}>
                  {renderGroup(group, undefined, false, Boolean(selectedGroup && !filtered))}
                </div>
              ))}
            </div>
            {visible.size === 0 ? (
              <ContentState
                action={
                  <Button
                    onClick={() => {
                      setSearch("");
                      setSearchResults(null);
                      setUntranslated(null);
                    }}
                    variant="secondary"
                  >
                    Clear filters
                  </Button>
                }
                density="compact"
                description={
                  untranslated && !query
                    ? "There are no untranslated fields in this worklist."
                    : "Try a different word, or clear your filters to browse sections."
                }
                state="no-results"
                title={untranslated && !query ? "All fields complete" : "No matching text"}
              />
            ) : null}
          </div>
        </section>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card pt-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-medium" role="status">
            {pending
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : missing === entries.length
                  ? "No translations yet"
                  : "All changes saved"}
          </p>
          <Caption className="mt-1 block text-muted-foreground">
            {locale === "en"
              ? dirty
                ? "Publishing changes returns other languages to draft for review."
                : "Changes are saved when you publish."
              : missing
                ? `Complete ${missing} more ${missing === 1 ? "field" : "fields"} to publish. You can save a draft now.`
                : savedStatus === "published" && !dirty
                  ? "This language is available on the public tool."
                  : "All fields are filled. Review the wording, then publish to make this language available."}
          </Caption>
          {locale !== "en" && savedStatus === "published" ? (
            <Caption className="mt-1 block text-muted-foreground">
              Saving as a draft removes this language from the public tool.
            </Caption>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {locale !== "en" || !enabled ? (
            <Button
              disabled={!dirty && savedStatus === "draft"}
              loading={pending}
              name="status"
              type="submit"
              value="draft"
              variant="secondary"
            >
              Save draft
            </Button>
          ) : null}
          <Button
            disabled={missing > 0 || (!dirty && savedStatus === "published")}
            loading={pending}
            name="status"
            type="submit"
            value="published"
          >
            {locale === "en" ? "Publish changes" : "Publish translation"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ToolTranslationsForm({
  toolId,
  englishMessages,
  translations,
  updatedAt,
  enabled,
}: {
  toolId: string;
  englishMessages: ToolMessages;
  translations: ToolTranslations;
  updatedAt: string;
  enabled: boolean;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [drafts, setDrafts] = useState<ToolTranslations>({
    ...translations,
    en: { status: translations.en?.status ?? "published", messages: englishMessages },
  });
  const [saved, setSaved] = useState(drafts);
  const [version, setVersion] = useState(updatedAt);
  const [source, setSource] = useState(englishMessages);
  const [saving, setSaving] = useState(false);
  const current = drafts[locale] ?? { status: "draft", messages: {} };
  const dirty = Object.keys(source).some((key) => {
    const value = current.messages[key];
    const previous = saved[locale]?.messages[key];
    return (value?.trim() ? value : "") !== (previous?.trim() ? previous : "");
  });

  const setMessage = (key: string, value: string) =>
    setDrafts((previous) => ({
      ...previous,
      [locale]: {
        status: previous[locale]?.status ?? "draft",
        messages: { ...previous[locale]?.messages, [key]: value },
      },
    }));
  useAssistantTarget({
    section: "translations",
    values: current.messages,
    apply: (key, value) => setMessage(key, String(value)),
    locale,
    activeKey,
  });

  return (
    <section
      aria-label="Translations"
      className="flex min-h-0 flex-1 gap-4"
      onFocusCapture={(event) => {
        const id = (event.target as HTMLElement).closest<HTMLElement>('[id^="translation-"]')?.id;
        const key = id && decodeURIComponent(id.slice("translation-".length));
        if (key && Object.hasOwn(source, key)) setActiveKey(key);
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TranslationFields
          languageControl={
            <div className="flex items-end gap-2">
              <Field className="min-w-0 flex-1" htmlFor="translation-language" label="Language to edit">
                <Select
                  disabled={saving}
                  id="translation-language"
                  onChange={(event) => {
                    if (isLocale(event.target.value)) setLocale(event.target.value);
                  }}
                  value={locale}
                >
                  {locales.map((language) => (
                    <option key={language} value={language}>
                      {localeLabels[language]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
          dirty={dirty}
          enabled={enabled}
          englishMessages={source}
          key={locale}
          locale={locale}
          messages={current.messages}
          translations={drafts}
          onPendingChange={setSaving}
          onReplace={(nextLocale, changes) => {
            setDrafts((previous) => {
              const next = { ...previous };
              for (const language of locales) {
                const messages = changes[language];
                if (messages) next[language] = { status: previous[language]?.status ?? "draft", messages };
              }
              return next;
            });
            setLocale(nextLocale);
          }}
          onChange={setMessage}
          onSaved={(nextVersion, status, sourceChanged) => {
            setVersion(nextVersion);
            setSaved((previous) => ({ ...previous, [locale]: { ...current, status } }));
            setDrafts((previous) =>
              Object.fromEntries(
                Object.entries({ ...previous, [locale]: { ...current, status } }).map(([language, entry]) => [
                  language,
                  sourceChanged && language !== "en" ? { ...entry, status: "draft" } : entry,
                ]),
              ),
            );
            if (locale === "en") setSource(current.messages);
          }}
          savedStatus={current.status}
          toolId={toolId}
          updatedAt={version}
        />
      </div>
    </section>
  );
}
