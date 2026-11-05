"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  MessagesSquare,
  Globe,
  History,
  ImagePlus,
  ImageIcon,
  ExternalLink,
  Link2,
  LoaderCircle,
  Paperclip,
  Plus,
  RotateCcw,
  FileText,
  SlidersHorizontal,
  Sparkles,
  AtSign,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import {
  BackButton,
  Button,
  ContentState,
  Popover,
  Input,
  Label,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@/components/ui/index.tsx";
import { NEW_THREAD_TITLE } from "@/lib/assistant/types";
import type { AssistantRun, AssistantThread, AssistantMessage, AssistantAttachment } from "@/lib/assistant/types";
import type { AssistantIntegrationUI } from "./types";
import styles from "./Assistant.module.css";
import { AssistantRunCard, AssistantSources, AssistantResultActions } from "./AssistantOutput";
import { agentSlashQuery, mentionQuery } from "@/lib/assistant/composer";
import { assistantCacheKey, assistantRequest } from "@/lib/assistant/client";
import { AssistantComposer, type AssistantComposerHandle } from "./AssistantComposer";
import { AssistantHeader } from "./AssistantHeader";
import { AssistantLinkForm } from "./AssistantLinkForm";
import { MarkdownPreview } from "@/components/content/MarkdownPreview";
import { useTypedText } from "./useTypedText";
import { AssistantProgress, AssistantThinking } from "./AssistantProgress";
import { AssistantModelPicker } from "./AssistantModelPicker";
import { ChangeCard } from "./ChangeCard";
import { ReportView } from "./ReportView";
import { useAssistant } from "@/lib/assistant/useAssistant";

type Props = {
  resourceId?: string;
  ownerId: string;
  integration: AssistantIntegrationUI;
  onClose?: () => void;
};
function readable(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not complete the action. Try again.";
}
export function groupConversationHistory(threads: AssistantThread[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, { label: string; threads: AssistantThread[] }>();
  const timestamp = (value: string) => Date.parse(value) || 0;
  for (const thread of [...threads].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))) {
    const date = new Date(thread.updatedAt);
    const valid = !Number.isNaN(date.getTime());
    const day = valid ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : null;
    const key = day === null ? "earlier" : String(day);
    const label =
      day === today.getTime()
        ? "Today"
        : day === yesterday.getTime()
          ? "Yesterday"
          : valid
            ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : "Earlier";
    const group = groups.get(key) ?? { label, threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function AssistantPanel(props: Props) {
  return (
    <TooltipProvider>
      <AssistantPanelInstance
        key={assistantCacheKey(props.ownerId, props.integration.key, props.resourceId)}
        {...props}
      />
    </TooltipProvider>
  );
}
function AssistantPanelInstance({ resourceId, ownerId, integration, onClose }: Props) {
  const assistant = useAssistant(integration.key, resourceId, ownerId);
  const instanceId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const messageId = `${instanceId}-message`;
  const commandsId = `${instanceId}-commands`;
  const contextErrorId = `${instanceId}-context-error`;
  const commandId = (index: number) => `${instanceId}-command-${index}`;
  const [tab, setTab] = useState("assistant");
  const [sourcesVisited, setSourcesVisited] = useState(false);
  useEffect(() => {
    if (tab === "sources") setSourcesVisited(true);
  }, [tab]);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<{ attachment: AssistantAttachment; html?: string } | null>(null);
  const [caret, setCaret] = useState(0);
  const [dismissedSlash, setDismissedSlash] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [panelView, setPanelView] = useState<"chat" | "history" | "settings">("chat");
  const showHistory = panelView === "history";
  const showSettings = panelView === "settings";
  const [showNewThread, setShowNewThread] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [attachmentMenu, setAttachmentMenu] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [contextByThread, setContextByThread] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; filename: string; scope: string } | null>(null);
  const [uploadingScopes, setUploadingScopes] = useState<Record<string, boolean>>({});
  const [preparingScopes, setPreparingScopes] = useState<Record<string, boolean>>({});
  const composer = useRef<AssistantComposerHandle>(null);
  /** Each thread's title when first shown, so only a later change types itself out. */
  const firstTitles = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const scope = assistant.scopeId;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const preparing = Object.keys(preparingScopes).some(
    (id) => preparingScopes[id] && assistant.resolveScopeId(id) === scope,
  );
  const uploading = Object.keys(uploadingScopes).some(
    (id) => uploadingScopes[id] && assistant.resolveScopeId(id) === scope,
  );
  const originScope =
    [...Object.keys(contextByThread), ...Object.keys(references)].find(
      (id) => id !== scope && assistant.resolveScopeId(id) === scope,
    ) ?? scope;
  const selectedAgentId = assistant.composerSelection.agentId;
  const selectedAgent = integration.agents.find((agent) => agent.id === selectedAgentId);
  const includeContext =
    selectedAgent?.requiresContext || (contextByThread[scope] ?? contextByThread[originScope] ?? true);
  const detail = assistant.detail;
  const settings = assistant.requestSettings;
  const runs = detail?.runs ?? [];
  const running = assistant.stream?.run;
  const busy = assistant.submitting || preparing;
  const ready = !!assistant.availability?.enabled && !assistant.loading;
  const refs = references[scope] ?? references[originScope] ?? "";
  const referenceLinks = refs
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const attachmentIds = assistant.composerSelection.attachmentIds;
  const invalidInputs = attachmentIds.some((id) => {
    const file = detail?.attachments.find((item) => item.id === id);
    return !file || file.status !== "ready" || !!(file.expiresAt && Date.parse(file.expiresAt) <= Date.now());
  });
  const unknownAgent = !!selectedAgentId && !selectedAgent;
  const contextProblem = integration.contextProblem(selectedAgentId, assistant.message, includeContext);
  const executions = (detail?.executions ?? []).filter((execution) => execution.executionMode === "standalone");
  const slashToken = agentSlashQuery(assistant.message, caret);
  const slashKey = slashToken ? `${slashToken.start}:${slashToken.end}:${slashToken.query}` : null;
  const commands = integration.agents.filter(
    (agent) =>
      !slashToken?.query ||
      `${agent.name} ${agent.command} ${agent.aliases.join(" ")}`.toLowerCase().includes(slashToken.query),
  );
  const slashOpen = integration.agents.length > 0 && !!slashToken && slashKey !== dismissedSlash;
  const mentionToken = integration.mentions?.length ? mentionQuery(assistant.message, caret) : null;
  const mentionKey = mentionToken ? `@${mentionToken.start}:${mentionToken.end}:${mentionToken.query}` : null;
  const mentions = (integration.mentions ?? [])
    .filter((entry) => !mentionToken?.query || `${entry.id} ${entry.label}`.toLowerCase().includes(mentionToken.query))
    .slice(0, 30);
  const mentionOpen = !slashOpen && !!mentionToken && mentionKey !== dismissedSlash;
  const menuOpen = slashOpen || mentionOpen;
  const menuItems = slashOpen
    ? commands.map(({ id, name, description, icon }) => ({ id, name, description, icon: icon ?? Sparkles }))
    : mentions.map(({ id, label, description }) => ({
        id,
        name: label,
        description: description ?? `@${id}`,
        icon: AtSign,
      }));
  function chooseMenuItem(index: number) {
    if (slashOpen) return chooseCommand(index);
    const entry = mentions[index];
    if (!entry || !mentionToken) return;
    setDismissedSlash(mentionKey);
    composer.current?.insertMention(entry.id, entry.label, mentionToken.start, mentionToken.end);
  }
  function selectAgent(id: string) {
    assistant.composerState({ ...assistant.getComposerSelection(), agentId: id, agentOffset: caret });
    composer.current?.insertAgent(id);
    setTab("assistant");
    setPanelView("chat");
    requestAnimationFrame(() => composer.current?.focus());
  }
  function chooseCommand(index: number) {
    const command = commands[index];
    if (!command || !slashToken) return;
    setDismissedSlash(slashKey);
    composer.current?.insertAgent(command.id, slashToken.start, slashToken.end);
  }

  function prepareAgentRequest(agentId: string | undefined, inputs: string[], instruction: string) {
    const ids = [...new Set([...assistant.getComposerSelection().attachmentIds, ...inputs])];
    if (ids.length > 5) {
      toast.error("Remove some composer attachments before adding this result. You can attach up to five.");
      return;
    }
    assistant.composerState({ ...assistant.getComposerSelection(), agentId, attachmentIds: ids });
    if (!assistant.getDraft().trim()) assistant.draft(instruction);
    setTab("assistant");
    requestAnimationFrame(() => composer.current?.focus());
  }
  function openAgentPicker() {
    const text = assistant.message + (assistant.message && !/\s$/.test(assistant.message) ? " /" : "/");
    assistant.draft(text);
    setCaret(text.length);
    setDismissedSlash(null);
    setTab("assistant");
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(text.length, text.length);
    });
  }
  async function prepareRetry(id: string) {
    try {
      const { run } = await assistantRequest<{ run: AssistantRun }>(`${assistant.apiBase}/runs/${id}`);
      if (currentScope.current !== scope) return;
      prepareAgentRequest(run.request.agentId, run.request.attachmentIds ?? [], run.request.message);
    } catch (cause) {
      toast.error(readable(cause));
    }
  }
  useEffect(() => {
    setArtifactId(null);
    setActiveResult(null);
  }, [scope]);
  useEffect(() => {
    setSlashIndex(0);
  }, [slashKey, mentionKey]);
  useEffect(() => {
    if (integration.initialAgentId) selectAgent(integration.initialAgentId);
  }, [integration.initialAgentId]);
  useEffect(() => {
    if (menuOpen) globalThis.document.getElementById(commandId(slashIndex))?.scrollIntoView({ block: "nearest" });
  }, [menuOpen, slashIndex]);
  function addReferenceLink() {
    try {
      const url = new URL(linkDraft.trim());
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
        throw new Error("Use a public HTTPS URL.");
      if (referenceLinks.length >= 5) throw new Error("Use at most five reference links.");
      if (referenceLinks.includes(url.href)) throw new Error("This link is already attached.");
      setReferences((value) => ({ ...value, [scope]: [...referenceLinks, url.href].join("\n") }));
      setLinkDraft("");
      setLinkError("");
      setShowReferences(false);
      setAttachmentMenu(false);
    } catch (cause) {
      setLinkError(cause instanceof TypeError ? "Enter a valid public HTTPS URL." : readable(cause));
      linkInput.current?.focus();
    }
  }
  function closePanelView() {
    setPanelView("chat");
    requestAnimationFrame(() => (showSettings ? settingsTrigger : historyTrigger).current?.focus());
  }
  function threadTime(value: string) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    if (minutes < 1) return "Now";
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  useEffect(() => {
    integration.observeRuns?.(runs, assistant.freshRunIds);
  }, [runs, assistant.freshRunIds, integration]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  useEffect(() => {
    messages.current?.scrollTo({ top: messages.current.scrollHeight });
  }, [assistant.selected, detail?.messages, assistant.stream?.text, executions.length]);
  useEffect(() => {
    if (!assistant.selected || !detail) return;
    const id = assistant.selected;
    const timer = setTimeout(() => {
      void assistant.saveDraft(assistant.message, id).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    assistant.selected,
    assistant.message,
    selectedAgentId,
    attachmentIds,
    assistant.composerSelection.agentOffset,
    assistant.composerSelection.content,
  ]);

  function transferComposer(nextScope: string) {
    if (assistant.selected) return;
    setReferences((value) => ({ ...value, [nextScope]: value[nextScope] ?? value[scope] ?? "" }));
    setContextByThread((value) => ({ ...value, [nextScope]: value[nextScope] ?? value[scope] ?? true }));
  }
  async function updateSettings(next: Record<string, unknown>) {
    try {
      await assistant.settings(next);
    } catch (cause) {
      toast.error(readable(cause));
    }
  }
  async function send(
    operation: string = integration.conversationOperation,
    retry?: AssistantRun,
    messageOverride?: string,
  ) {
    if (!ready || busy || uploading || !integration.enabled) return;
    if (!retry && operation === integration.conversationOperation && selectedAgent)
      operation = integration.agentOperation;
    if (!retry && contextProblem) {
      composer.current?.focus();
      return;
    }
    if (!retry && (invalidInputs || unknownAgent)) {
      toast.error("Remove or replace unavailable composer selections first.");
      return;
    }
    const message =
      (messageOverride ?? retry?.request.message ?? assistant.message.trim()) ||
      (selectedAgent ? `Run ${selectedAgent.name}.` : "");
    if (!message) {
      composer.current?.focus();
      return;
    }
    let prepared: ReturnType<AssistantIntegrationUI["prepareRequest"]> | undefined;
    try {
      prepared = integration.prepareRequest({
        operation,
        agentId: retry ? retry.request.agentId : selectedAgentId,
        message,
        retry,
        includeContext,
        settings,
        attachmentIds: retry?.request.attachmentIds ?? attachmentIds,
      });
      const sent = await assistant.send(
        prepared.input,
        (run) => {
          if (run.threadId) transferComposer(run.threadId);
          prepared?.onCreated?.(run);
        },
        scope,
        {
          executionMode:
            operation === integration.agentOperation && integration.agentOperation !== integration.conversationOperation
              ? "standalone"
              : "conversational",
          referenceLinks: retry ? [] : referenceLinks,
          onReferenceAdded: (threadId, remaining) => {
            const text = remaining.join("\n");
            setReferences((value) => ({ ...value, [scope]: text, [threadId]: text }));
          },
        },
      );
      if (!sent) prepared.dispose?.();
    } catch (cause) {
      prepared?.dispose?.();
      toast.error(readable(cause));
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      toast.error("Choose a JPEG, PNG, or WebP image up to 5 MiB.");
      return;
    }
    if (attachmentIds.length >= 3) {
      toast.error("Use at most three images per request.");
      return;
    }
    setUploadingScopes((value) => ({ ...value, [scope]: true }));
    setPreview({ filename: file.name, url: URL.createObjectURL(file), scope });
    try {
      const attachment = await assistant.upload(file, scope);
      transferComposer(attachment.threadId);
      const selection = assistant.getComposerSelection(attachment.threadId);
      assistant.composerState(
        { ...selection, attachmentIds: [...new Set([...selection.attachmentIds, attachment.id])] },
        attachment.threadId,
      );
      setPreview((value) => (value?.scope === scope ? null : value));
    } catch (cause) {
      toast.error(readable(cause));
    } finally {
      setUploadingScopes((value) => ({ ...value, [scope]: false }));
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const thinking = (
    <AssistantThinking reasoning={assistant.stream?.reasoning} answering={!!assistant.stream?.text} />
  );
  // An unnamed thread shows "Assistant" until the title model names it, so the header changes once.
  const threadTitle = (assistant.selected && detail?.thread.title !== NEW_THREAD_TITLE && detail?.thread.title) || "";
  // A title types itself out only when it appears or changes while this thread is open, not on load or switch.
  const seenTitle = assistant.selected ? firstTitles.current.get(assistant.selected) : undefined;
  if (assistant.selected && detail?.thread.id === assistant.selected && seenTitle === undefined)
    firstTitles.current.set(assistant.selected, threadTitle);
  const typedTitle =
    useTypedText(
      threadTitle,
      threadTitle && seenTitle !== undefined && seenTitle !== threadTitle
        ? `title:${assistant.selected}:${threadTitle}`
        : null,
    ) || "Assistant";
  // Retries answer the same question; group them so only one answer per question shows.
  const variantRuns = new Map<string, AssistantRun[]>();
  for (const run of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    if (run.inputMessageId && run.executionMode === "conversational")
      variantRuns.set(run.inputMessageId, [...(variantRuns.get(run.inputMessageId) ?? []), run]);
  /** Answers that can be paged: completed ones, plus the newest while it is the one shown. */
  function variantsOf(questionId: string) {
    const all = variantRuns.get(questionId) ?? [];
    const pinned = detail?.messages.find((message) => message.id === questionId)?.meta.activeRunId;
    const shown = all.find((run) => run.id === pinned && run.status === "completed") ?? all.at(-1);
    const list = all.filter((run) => run.status === "completed" || run === all.at(-1));
    return { list: shown && !list.includes(shown) ? [...list, shown] : list, shown };
  }
  const latestQuestionId = (detail?.messages ?? []).filter((message) => message.role === "user").at(-1)?.id;
  function result(run: AssistantRun, message: AssistantMessage) {
    const variants = run.inputMessageId ? variantsOf(run.inputMessageId).list : [run];
    const position = variants.findIndex((entry) => entry.id === run.id);
    // Only the latest answer can be retried, so the conversation never branches.
    const retryable = !run.inputMessageId || run.inputMessageId === latestQuestionId;
    const showVariant = (next: AssistantRun | undefined) => {
      if (!next || !run.inputMessageId || next.status !== "completed") return;
      assistant.selectVariant(run.inputMessageId, next.id).catch((cause) => toast.error(readable(cause)));
    };
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const view = integration.response(run, message, assistant.freshRunIds.includes(run.id));
    return (
      <article key={message.id} className={styles.assistantResponse}>
        {run.status !== "completed" &&
          (tab === "assistant" || assistant.stream?.run.id !== run.id) &&
          (assistant.stream?.run.id === run.id && run.status !== "failed" && run.status !== "cancelled" ? (
            thinking
          ) : (
            <p role="status" className="text-caption text-muted-foreground">
              {run.status === "failed"
                ? "Generation failed"
                : run.status === "cancelled"
                  ? "Request stopped"
                  : "Saved outcome unconfirmed · Refresh history to check"}
            </p>
          ))}
        {run.errorMessage && <p className="text-caption text-destructive">{run.errorMessage}</p>}
        {(assistant.stream?.run.id === run.id ? assistant.stream.text || text : text) && (
          <TypedMarkdown
            typingKey={assistant.stream?.run.id === run.id || assistant.freshRunIds.includes(run.id) ? run.id : null}
            markdown={assistant.stream?.run.id === run.id ? assistant.stream.text || text : text}
            {...integration.markdown}
            className={styles.assistantMarkdown}
          />
        )}
        {view.warning && <p className="text-caption text-warning">{view.warning}</p>}
        {view.report && (view.report.summary || view.report.sections.length > 0) && <ReportView report={view.report} />}
        {view.note && <p className="text-caption text-muted-foreground">{view.note}</p>}
        {run.status === "completed" && view.changes.map(({ id, ...change }) => <ChangeCard key={id} {...change} />)}
        {run.status === "completed" && (
          <div className="-mt-2 flex w-fit items-center gap-0 text-muted-foreground">
            {variants.length > 1 && position >= 0 && (
              <div className="order-last flex items-center" role="group" aria-label="Response versions">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-6"
                  aria-label="Previous response"
                  disabled={busy || position === 0}
                  onClick={() => showVariant(variants[position - 1])}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="min-w-8 text-center text-caption tabular-nums" aria-live="polite">
                  {position + 1}/{variants.length}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-6"
                  aria-label="Next response"
                  disabled={busy || position === variants.length - 1}
                  onClick={() => showVariant(variants[position + 1])}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            )}
            {text && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-6"
                    aria-label="Copy response"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(text);
                        toast.success("Response copied");
                      } catch {
                        toast.error("Could not copy. Select the response text and copy it manually.");
                      }
                    }}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy response</TooltipContent>
              </Tooltip>
            )}
            {retryable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-6"
                    aria-label="Retry response"
                    disabled={busy || !ready || uploading || !integration.enabled}
                    onClick={() => void send(run.operation, run)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry response</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {retryable && ["failed", "cancelled"].includes(run.status) && (
          <Button size="sm" variant="outline" disabled={busy || !ready} onClick={() => void send(run.operation, run)}>
            Try again
          </Button>
        )}
      </article>
    );
  }
  function openSourceLink() {
    setTab("assistant");
    setShowReferences(true);
    setLinkError("");
    setAttachmentMenu(true);
    requestAnimationFrame(() => linkInput.current?.focus());
  }
  const visibleMessages = detail?.messages ?? [];
  const timeline = [
    ...visibleMessages.map((message) => ({ kind: "message" as const, message, createdAt: message.createdAt })),
    ...executions.map((execution) => ({ kind: "execution" as const, execution, createdAt: execution.createdAt })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const showConversationError =
    tab === "assistant" &&
    !showHistory &&
    !showSettings &&
    !activeResult &&
    !!assistant.error &&
    !assistant.loading &&
    !timeline.length &&
    !assistant.stream;
  const showLaunch =
    tab === "assistant" &&
    !assistant.loading &&
    !busy &&
    !timeline.length &&
    !assistant.stream &&
    !showConversationError;
  function newThread() {
    assistant.startNewThread();
    setPanelView("chat");
    setShowNewThread(true);
    setTab("assistant");
    requestAnimationFrame(() => composer.current?.focus());
  }
  return (
    <div
      ref={panel}
      className={`${styles.sidePanelContent} ${styles.agentPanel}`}
      data-history={showHistory}
      onKeyDown={(event) => {
        if (event.key === "Escape" && panelView !== "chat") {
          event.preventDefault();
          event.stopPropagation();
          closePanelView();
        }
      }}
    >
      <AssistantHeader
        title={showHistory ? "Conversations" : showSettings ? "Settings" : typedTitle}
        onClose={onClose}
        closeLabel="Close assistant"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="New thread"
              disabled={assistant.loading}
              onClick={newThread}
            >
              <SquarePen aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New thread</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={historyTrigger}
              size="icon-xs"
              variant="ghost"
              aria-label="History"
              aria-pressed={showHistory}
              onClick={() => setPanelView(showHistory ? "chat" : "history")}
            >
              <History aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>History</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={settingsTrigger}
              size="icon-xs"
              variant="ghost"
              aria-label="Assistant settings"
              aria-pressed={showSettings}
              onClick={() => {
                setAttachmentMenu(false);
                setPanelView(showSettings ? "chat" : "settings");
              }}
            >
              <SlidersHorizontal aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Assistant settings</TooltipContent>
        </Tooltip>
      </AssistantHeader>
      {showSettings && (
        <section className="min-h-0 flex-1 space-y-4 overflow-y-auto" aria-label="Assistant settings">
          <p className="truncate text-caption text-muted-foreground">
            {integration.resourceLabel} · {integration.resourceTitle}
          </p>
          <BackButton label="Back to chat" onClick={closePanelView} />
          <div className="flex items-center gap-3 border-b border-border py-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <Label htmlFor={`${instanceId}-assistant-draft-context`}>Include current content</Label>
              <p className="mt-1 text-caption text-muted-foreground">{integration.contextDescription}</p>
            </div>
            <Switch
              id={`${instanceId}-assistant-draft-context`}
              checked={includeContext}
              disabled={selectedAgent?.requiresContext}
              onCheckedChange={(included) => setContextByThread((value) => ({ ...value, [scope]: included }))}
            />
          </div>
          <div className="flex items-center justify-between gap-3 py-2">
            <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1">
              <Label htmlFor={`${instanceId}-assistant-web`}>Web search</Label>
              <p className="mt-1 text-caption text-muted-foreground">Find up-to-date sources online.</p>
            </div>
            <Switch
              id={`${instanceId}-assistant-web`}
              checked={settings.webSearch === true}
              disabled={!assistant.availability?.capabilities.webSearch}
              onCheckedChange={(webSearch) => void updateSettings({ webSearch })}
            />
          </div>
          {integration.selectSettings?.map((setting) => (
            <div className="space-y-1" key={setting.key}>
              <Label htmlFor={`${instanceId}-setting-${setting.key}`}>{setting.label}</Label>
              <Select
                id={`${instanceId}-setting-${setting.key}`}
                value={
                  typeof settings[setting.key] === "string"
                    ? (settings[setting.key] as string)
                    : (setting.options[0] ?? "")
                }
                onChange={(event) => void updateSettings({ [setting.key]: event.target.value })}
              >
                {setting.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </Select>
            </div>
          ))}
        </section>
      )}
      {showHistory && (
        <section className={styles.assistantHistory} aria-label="Conversation history">
          <p className="shrink-0 truncate text-caption text-muted-foreground">
            {integration.resourceLabel} · {integration.resourceTitle}
          </p>
          <div className="flex h-9 shrink-0 items-center justify-between gap-2">
            <BackButton label="Back to chat" onClick={closePanelView} />
            {!!assistant.activeThreadIds.length && (
              <span
                className="flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-caption text-accent-text"
                role="status"
              >
                <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" />
                {assistant.activeThreadIds.length} responding
              </span>
            )}
          </div>
          {!assistant.threads.length ? (
            assistant.historyStatus === "loading" ? (
              <AssistantProgress centered>Loading conversations…</AssistantProgress>
            ) : (
              <ContentState
                className="my-auto"
                density="panel"
                headingLevel="h3"
                announcement="polite"
                state={assistant.historyStatus === "error" ? "error" : "empty"}
                icon={assistant.historyStatus === "error" ? <CloudOff /> : <MessagesSquare />}
                title={assistant.historyStatus === "error" ? "Couldn’t load history" : "No conversations yet"}
                description={
                  assistant.historyStatus === "error" ? (
                    <>
                      Try again to see your conversations.
                      <br />
                      You can still start a new thread.
                    </>
                  ) : (
                    `Start a thread about ${integration.resourceLabel.toLowerCase()}.`
                  )
                }
                action={
                  assistant.historyStatus === "error" ? (
                    <Button size="sm" variant="outline" className="text-body" onClick={() => void assistant.refresh()}>
                      Try again
                    </Button>
                  ) : (
                    <Button size="sm" className="text-body" onClick={newThread}>
                      New thread
                    </Button>
                  )
                }
              />
            )
          ) : (
            <nav
              className={styles.assistantHistoryRows}
              aria-label="Recent conversations"
              aria-busy={assistant.historyStatus === "loading"}
            >
              {groupConversationHistory(assistant.threads).map((group) => (
                <section key={group.label} className={styles.assistantHistoryGroup} aria-label={group.label}>
                  <h3 className={styles.assistantHistoryGroupLabel}>{group.label}</h3>
                  {group.threads.map((thread) => (
                    <Button
                      variant="ghost"
                      type="button"
                      key={thread.id}
                      className={`${styles.assistantHistoryRow} ${assistant.selected === thread.id ? styles.assistantHistorySelected : ""}`}
                      aria-current={assistant.selected === thread.id ? "true" : undefined}
                      onClick={() => {
                        void assistant.choose(thread.id);
                        setShowNewThread(false);
                        setPanelView("chat");
                      }}
                    >
                      <span className={styles.assistantHistoryMain}>
                        <span className={styles.assistantHistoryTitle}>{thread.title}</span>
                        {assistant.selected === thread.id && (
                          <Check className="size-3.5 shrink-0 text-accent-text" aria-hidden="true" />
                        )}
                        <time className={styles.assistantHistoryTime} dateTime={thread.updatedAt}>
                          {threadTime(thread.updatedAt)}
                        </time>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </span>
                      {assistant.activeThreadIds.includes(thread.id) && (
                        <span className="flex items-center gap-1 text-caption text-accent-text">
                          <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" />
                          Responding
                        </span>
                      )}
                    </Button>
                  ))}
                </section>
              ))}
            </nav>
          )}
          {!!assistant.threads.length && !!assistant.activeThreadIds.length && (
            <p className="shrink-0 text-caption leading-relaxed text-muted-foreground">
              Switch freely. Other responses keep running.
            </p>
          )}
        </section>
      )}
      {assistant.error &&
        !showSettings &&
        !showConversationError &&
        // An error with nothing else to show is presented once, in the Chat tab's empty state.
        (timeline.length > 0 || !!assistant.stream || showHistory || !!activeResult) &&
        (!showHistory || assistant.historyStatus !== "error") && (
          <div className="py-2">
            <p role="alert" className="text-caption text-destructive">
              {assistant.error}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void assistant.refresh()}>
              Refresh history
            </Button>
          </div>
        )}
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setActiveResult(null);
          setTab(next);
        }}
        className={`min-h-0 flex-1 gap-2.5 ${panelView !== "chat" ? "hidden" : ""}`}
      >
        <TabsList className={styles.assistantTabs} aria-label="Assistant workspace">
          <TabsTrigger value="assistant" className="flex-none" onClick={() => setActiveResult(null)}>
            Chat
          </TabsTrigger>
          <TabsTrigger value="sources" className="flex-none">
            Sources
          </TabsTrigger>
        </TabsList>
        {(sourcesVisited || tab === "sources") && (
          <TabsContent value="sources" forceMount className="min-h-0 flex flex-col data-[state=inactive]:hidden">
            <AssistantSources
              key={`${integration.key}:${resourceId}:${assistant.selected}`}
              active={tab === "sources" && panelView === "chat"}
              integration={integration}
              threadId={assistant.selected}
              artifactId={artifactId}
              refreshKey={JSON.stringify([
                (detail?.attachments ?? [])
                  .filter((file) => file.type !== "artifact")
                  .map((file) => `${file.id}:${file.updatedAt}:${file.status}`)
                  .sort(),
                executions.flatMap((entry) => (entry.artifact ? [entry.artifact.attachmentId] : [])).sort(),
              ])}
              onOpen={setArtifactId}
              onShowRun={(id) => {
                setTab("assistant");
                requestAnimationFrame(() =>
                  (() => {
                    const activity = panel.current?.querySelector<HTMLElement>(`[data-agent-run="${CSS.escape(id)}"]`);
                    activity?.scrollIntoView({ block: "nearest" });
                    activity?.focus({ preventScroll: true });
                  })(),
                );
              }}
            />
          </TabsContent>
        )}
        {tab !== "sources" &&
          (activeResult && activeResult.attachment.threadId === assistant.selected ? (
            <AssistantResultActions
              key={activeResult.attachment.id}
              {...activeResult}
              integration={integration}
              onRetry={() => {
                setActiveResult(null);
                if (activeResult.attachment.expiresAt && Date.parse(activeResult.attachment.expiresAt) <= Date.now())
                  openAgentPicker();
                else if (activeResult.attachment.runId) void prepareRetry(activeResult.attachment.runId);
              }}
              onBack={() => setActiveResult(null)}
              onAttach={(id, agentId, instruction) => {
                setActiveResult(null);
                assistant.rememberAttachment(activeResult.attachment);
                prepareAgentRequest(agentId, [id], instruction ?? "Use the attached result to ");
              }}
            />
          ) : (
            <>
              <div
                ref={messages}
                className={`min-h-0 flex-1 overflow-y-auto ${showLaunch || showConversationError || assistant.loading ? "flex flex-col" : "space-y-3.5"}`}
              >
                <>
                  {showConversationError && (
                    <ContentState
                      density="panel"
                      state="error"
                      headingLevel="h3"
                      title="Assistant needs attention"
                      description={assistant.error}
                      announcement="assertive"
                      action={
                        <Button variant="outline" size="sm" onClick={() => void assistant.refresh()}>
                          Refresh history
                        </Button>
                      }
                    />
                  )}
                  {showLaunch && (
                    <section
                      aria-label="Start a conversation"
                      className="my-auto flex shrink-0 flex-col items-start gap-2 py-2 text-left"
                    >
                      <h3 className="text-xl font-semibold leading-[1.25]">{integration.launchTitle}</h3>
                      <p className="text-caption leading-[1.4] text-muted-foreground">
                        Choose a starting point, or ask anything.
                      </p>
                      <div className="flex w-full flex-col gap-2">
                        {integration.launchActions.map((action) => {
                          const Icon = action.icon;
                          return (
                            <Button
                              key={action.label}
                              size="sm"
                              variant="ghost"
                              className="h-auto min-h-10 w-full justify-start gap-2.5 whitespace-normal px-2.5 py-1 text-left font-normal"
                              disabled={!ready || busy}
                              onClick={() =>
                                action.instruction || !action.agentId
                                  ? prepareAgentRequest(action.agentId, [], action.instruction ?? "")
                                  : selectAgent(action.agentId)
                              }
                            >
                              <Icon className="size-[17px] text-accent-text" aria-hidden="true" />
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-sm font-medium leading-4">{action.label}</span>
                                <span className="text-xs leading-[14px] text-muted-foreground">
                                  {action.description}
                                </span>
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                      <div className="space-y-1 text-xs leading-normal text-muted-foreground">
                        <p>You review every change before applying it.</p>
                        {!includeContext && (
                          <p>Your current content is excluded. Include it in settings to use it as context.</p>
                        )}
                      </div>
                    </section>
                  )}
                  {assistant.loading ? (
                    <AssistantProgress centered>Loading private conversations…</AssistantProgress>
                  ) : timeline.length ? (
                    timeline.map((entry) => {
                      if (entry.kind === "execution")
                        return (
                          <AssistantRunCard
                            key={entry.execution.id}
                            execution={entry.execution}
                            integration={integration}
                            busy={busy}
                            onOpen={(id) => {
                              setArtifactId(id);
                              setTab("sources");
                            }}
                            onUse={async (id) => {
                              setPreparingScopes((value) => ({ ...value, [scope]: true }));
                              try {
                                const result = await assistantRequest<{
                                  attachment: AssistantAttachment;
                                  html?: string;
                                }>(`${assistant.apiBase}/threads/${assistant.selected}/attachments/${id}`);
                                if (currentScope.current === scope) setActiveResult(result);
                              } catch (cause) {
                                toast.error(readable(cause));
                              } finally {
                                setPreparingScopes((value) => ({ ...value, [scope]: false }));
                              }
                            }}
                            onRetry={(id) => void prepareRetry(id)}
                            onNewRequest={openAgentPicker}
                            onCopy={(id) => {
                              void assistantRequest<{ attachment: AssistantAttachment }>(
                                `${assistant.apiBase}/threads/${assistant.selected}/attachments/${id}`,
                              )
                                .then(async ({ attachment }) => {
                                  const model = integration.artifact(attachment);
                                  if (!model.supported) throw new Error("This output is unavailable.");
                                  await navigator.clipboard.writeText(model.text);
                                  toast.success("Copied");
                                })
                                .catch((cause) => toast.error(readable(cause)));
                            }}
                            onRefresh={() => void assistant.refresh()}
                          />
                        );
                      const message = entry.message;
                      const run = runs.find((entry) => entry.id === message.runId);
                      if (
                        message.role === "assistant" &&
                        run?.inputMessageId &&
                        run.executionMode === "conversational" &&
                        variantsOf(run.inputMessageId).shown?.id !== run.id
                      )
                        return null;
                      if (message.role === "assistant" && run) return result(run, message);
                      return (
                        <article key={message.id} className={styles.assistantUserMessage}>
                          {message.parts.map((part, index) => {
                            if (part.type === "text")
                              return (
                                <p key={index} className="whitespace-pre-wrap break-words text-sm leading-[1.4]">
                                  {part.text}
                                </p>
                              );
                            if (part.type !== "attachment") return null;
                            const attachment = detail?.attachments.find((entry) => entry.id === part.attachmentId);
                            if (
                              !attachment ||
                              attachment.status !== "ready" ||
                              (attachment.expiresAt && Date.parse(attachment.expiresAt) <= Date.now())
                            )
                              return (
                                <p key={index} className="text-caption text-muted-foreground">
                                  Attachment unavailable
                                </p>
                              );
                            return attachment.type === "link" &&
                              attachment.data.url &&
                              /^https:\/\//i.test(attachment.data.url) ? (
                              <a
                                key={index}
                                href={attachment.data.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 rounded-lg bg-card p-2 text-sm"
                              >
                                <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{attachment.label}</span>
                                  <span className="text-caption text-muted-foreground">Link · Open reference</span>
                                </span>
                                <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                              </a>
                            ) : (
                              <div key={index} className="flex items-center gap-3 rounded-lg bg-card p-2">
                                <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded bg-muted">
                                  <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm">{attachment.label}</span>
                                  <span className="text-caption text-muted-foreground">
                                    Image · Sent with your message
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                          {message.meta.failed === true && (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-caption text-muted-foreground">Response unavailable</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  void navigator.clipboard
                                    .writeText(
                                      message.parts
                                        .filter((part) => part.type === "text")
                                        .map((part) => part.text)
                                        .join("\n"),
                                    )
                                    .then(() => toast.success("Request copied"))
                                    .catch((cause) => toast.error(readable(cause)));
                                }}
                              >
                                Copy request
                              </Button>
                            </div>
                          )}
                        </article>
                      );
                    })
                  ) : null}
                  {detail?.executionsCursor && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void assistant.loadExecutions().catch((cause) => toast.error(readable(cause)))}
                    >
                      Load earlier activity
                    </Button>
                  )}
                  {assistant.stream &&
                    assistant.stream.run.executionMode !== "standalone" &&
                    !visibleMessages.some((message) => message.runId === assistant.stream?.run.id) && (
                      <div className="py-4">
                        {tab === "assistant" && thinking}
                        <TypedMarkdown
                          typingKey={assistant.stream.run.id}
                          markdown={assistant.stream.text}
                          {...integration.markdown}
                          className={styles.assistantMarkdown}
                        />
                      </div>
                    )}
                  {assistant.submitting && !assistant.stream && <AssistantThinking answering={false} />}
                  {!assistant.loading && assistant.availability && !assistant.availability.enabled && (
                    <p className="text-caption text-muted-foreground">
                      {assistant.availability.reason ??
                        "AI assistance is not configured. You can continue writing manually."}
                    </p>
                  )}
                </>
              </div>
              {includeContext && (
                <div className="-mb-1.5 flex shrink-0">
                  <span className="inline-flex h-[26px] max-w-full items-center gap-1 rounded-md border border-border bg-card pl-1.5 pr-0.5 text-xs">
                    <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{integration.contextLabel}</span>
                    {!selectedAgent?.requiresContext && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="size-6 shrink-0 [&_svg]:size-3"
                            aria-label="Remove current context"
                            onClick={() => {
                              setContextByThread((value) => ({ ...value, [scope]: false }));
                              composer.current?.focus();
                            }}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove current context</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </div>
              )}
              <div className={styles.agentComposerAnchor}>
                {menuOpen && (
                  <div className={styles.agentCommandMenu}>
                    <div
                      role="listbox"
                      id={commandsId}
                      aria-label={slashOpen ? "Agents" : "Fields"}
                      className={styles.agentCommandOptions}
                    >
                      <p role="presentation" className={styles.agentCommandHeading}>
                        {slashOpen ? "Agents · who helps" : "Fields · what to work on"}
                      </p>
                      {!menuItems.length && (
                        <p className="px-2 py-3 text-center text-caption text-muted-foreground">
                          {slashOpen ? "No matching agents" : "No matching fields"}
                        </p>
                      )}
                      {menuItems.map((item, index) => {
                        const Icon = item.icon;
                        return (
                          <Button
                            key={item.id}
                            id={commandId(index)}
                            role="option"
                            aria-selected={index === slashIndex}
                            variant="ghost"
                            className={styles.agentCommandOption}
                            onMouseDown={(event) => event.preventDefault()}
                            onPointerMove={() => setSlashIndex(index)}
                            onClick={() => chooseMenuItem(index)}
                          >
                            <Icon aria-hidden="true" />
                            <span>
                              <span className={styles.agentCommandName}>{item.name}</span>
                              <span className={styles.agentCommandDescription}>{item.description}</span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                    <div className={styles.agentCommandHints} aria-label="Agent picker keyboard shortcuts">
                      <span>
                        <kbd>↑ ↓</kbd> Move
                      </span>
                      <span>
                        <kbd>↵</kbd> Insert
                      </span>
                      <span>
                        <kbd>Esc</kbd> Close
                      </span>
                    </div>
                  </div>
                )}
                <div
                  className={`${styles.assistantComposer} m-0 min-h-0 overflow-y-auto bg-card data-[state=inactive]:hidden`}
                >
                  {preview && preview.scope === scope && (
                    <div className="flex items-center gap-2">
                      <img
                        src={preview.url}
                        alt={`Attachment preview: ${preview.filename}`}
                        className="size-12 rounded-md object-cover"
                      />
                      <p className="truncate text-caption">
                        {uploading ? "Uploading… " : "Upload failed. Choose the image again to retry. "}
                        {preview.filename}
                      </p>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Dismiss attachment preview"
                        disabled={uploading}
                        onClick={() => setPreview(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  )}
                  {!!attachmentIds.length && (
                    <div className="flex max-h-32 flex-col gap-1 overflow-auto">
                      {attachmentIds.map((id) => {
                        const file = detail?.attachments.find((entry) => entry.id === id);
                        const unavailable =
                          !file ||
                          file.status !== "ready" ||
                          !!(file.expiresAt && Date.parse(file.expiresAt) <= Date.now());
                        return (
                          <div
                            key={id}
                            className="flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-caption"
                          >
                            <FileText className="size-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {file?.label ?? "Attachment"}
                              {unavailable ? " · Unavailable" : ""}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${file?.label ?? "unavailable attachment"} from message`}
                              onClick={() =>
                                assistant.composerState({
                                  ...assistant.getComposerSelection(),
                                  attachmentIds: attachmentIds.filter((entry) => entry !== id),
                                })
                              }
                            >
                              <X />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(invalidInputs || unknownAgent) && (
                    <p role="alert" className="text-caption text-destructive">
                      Remove or replace unavailable selections before sending.
                    </p>
                  )}
                  {!!referenceLinks.length && (
                    <div className="flex max-h-40 flex-col gap-2 overflow-auto">
                      {referenceLinks.map((url) => (
                        <div key={url} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                          <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 text-caption hover:underline"
                          >
                            <span className="block truncate">{new URL(url).hostname}</span>
                            <span className="text-muted-foreground">Link · Not read</span>
                          </a>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove reference ${url}`}
                            onClick={() =>
                              setReferences((value) => ({
                                ...value,
                                [scope]: referenceLinks.filter((entry) => entry !== url).join("\n"),
                              }))
                            }
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Label htmlFor={messageId} className="sr-only">
                    Message to assistant
                  </Label>
                  <AssistantComposer
                    id={messageId}
                    commandsId={commandsId}
                    agents={integration.agents}
                    key={scope}
                    ref={composer}
                    value={assistant.message}
                    content={assistant.composerSelection.content}
                    agentId={selectedAgentId}
                    agentOffset={assistant.composerSelection.agentOffset}
                    expanded={menuOpen}
                    describedBy={contextProblem ? contextErrorId : undefined}
                    activeDescendant={
                      menuOpen && menuItems.length ? commandId(Math.min(slashIndex, menuItems.length - 1)) : undefined
                    }
                    onCaret={setCaret}
                    onChange={({ text, agentId, agentOffset, content }) => {
                      assistant.draft(text);
                      assistant.composerState({ ...assistant.getComposerSelection(), agentId, agentOffset, content });
                      setDismissedSlash(null);
                    }}
                    placeholder={
                      showNewThread && !visibleMessages.length
                        ? "What would you like to work on?"
                        : visibleMessages.length
                          ? "Write a follow-up…"
                          : integration.placeholder
                    }
                    onKeyDown={(event) => {
                      if (event.isComposing) return;
                      if (menuOpen) {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          setSlashIndex((index) =>
                            menuItems.length
                              ? (index + (event.key === "ArrowDown" ? 1 : -1) + menuItems.length) % menuItems.length
                              : 0,
                          );
                          return;
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setDismissedSlash(slashOpen ? slashKey : mentionKey);
                          return;
                        }
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          chooseMenuItem(slashIndex);
                          return;
                        }
                      }
                      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  {contextProblem && (
                    <p id={contextErrorId} role="status" className="text-caption text-destructive">
                      {contextProblem}
                    </p>
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={(event) => void upload(event.target.files?.[0])}
                    />
                    {integration.attachments !== false && (
                      <Popover.Root
                        open={attachmentMenu}
                        onOpenChange={(open) => {
                          setAttachmentMenu(open);
                          if (!open) setShowReferences(false);
                        }}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Popover.Trigger asChild>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground"
                                aria-label="Attach files or links"
                              >
                                <Paperclip aria-hidden="true" />
                              </Button>
                            </Popover.Trigger>
                          </TooltipTrigger>
                          <TooltipContent>Attach files or links</TooltipContent>
                        </Tooltip>
                        <Popover.Portal>
                          <Popover.Content
                            side="top"
                            align="start"
                            sideOffset={8}
                            collisionPadding={16}
                            className={`z-50 flex max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-card shadow-md ${showReferences ? "w-80 gap-3 p-4" : "w-56 p-1"}`}
                            onEscapeKeyDown={(event) => event.stopPropagation()}
                          >
                            {showReferences ? (
                              <AssistantLinkForm
                                title="Add a reference link"
                                inputRef={linkInput}
                                url={linkDraft}
                                error={linkError}
                                help="Attach a public HTTPS page as a reference."
                                onUrlChange={(value) => {
                                  setLinkDraft(value);
                                  setLinkError("");
                                }}
                                onSubmit={addReferenceLink}
                                onCancel={() => {
                                  setAttachmentMenu(false);
                                  setShowReferences(false);
                                }}
                              />
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="justify-start"
                                  disabled={
                                    !ready ||
                                    uploading ||
                                    !assistant.availability?.capabilities.images ||
                                    attachmentIds.length >= 3
                                  }
                                  onClick={() => {
                                    setAttachmentMenu(false);
                                    fileInput.current?.click();
                                  }}
                                >
                                  <ImagePlus />
                                  Upload image
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="justify-start"
                                  onClick={() => {
                                    setShowReferences(true);
                                    setLinkError("");
                                    requestAnimationFrame(() => linkInput.current?.focus());
                                  }}
                                >
                                  <Link2 />
                                  Add link
                                </Button>
                                {(detail?.attachments ?? [])
                                  .filter(
                                    (file) =>
                                      file.status === "ready" &&
                                      (selectedAgent || !file.messageId || file.type === "artifact"),
                                  )
                                  .map((file) => (
                                    <Button
                                      key={file.id}
                                      size="sm"
                                      variant="ghost"
                                      className="justify-start truncate"
                                      aria-pressed={attachmentIds.includes(file.id)}
                                      disabled={
                                        !attachmentIds.includes(file.id) &&
                                        attachmentIds.length >= (selectedAgent ? 5 : 3)
                                      }
                                      onClick={() => {
                                        assistant.composerState({
                                          ...assistant.getComposerSelection(),
                                          attachmentIds: attachmentIds.includes(file.id)
                                            ? attachmentIds.filter((id) => id !== file.id)
                                            : [...attachmentIds, file.id],
                                        });
                                        setAttachmentMenu(false);
                                      }}
                                    >
                                      <FileText />
                                      <span className="truncate">{file.label}</span>
                                    </Button>
                                  ))}
                                <p className="px-3 py-2 text-caption text-muted-foreground">
                                  {attachmentIds.length >= 3
                                    ? "Three images selected. Remove one to upload another."
                                    : "JPEG, PNG, WebP · up to 5 MiB · three per request"}
                                </p>
                              </>
                            )}
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    )}
                    <span className="flex-1" />
                    {assistant.models && assistant.models.models.length > 0 && (
                      <AssistantModelPicker
                        models={assistant.models}
                        choice={assistant.modelChoice}
                        defaultEffort={selectedAgent?.effort ?? "medium"}
                        disabled={busy}
                        onChange={assistant.setModelChoice}
                      />
                    )}
                    {assistant.message.length > 7600 && (
                      <span className="text-caption text-muted-foreground">{assistant.message.length}/8,000</span>
                    )}
                    {busy ? (
                      <Button
                        size="icon-sm"
                        aria-label="Stop"
                        className={styles.assistantSend}
                        onClick={() => void assistant.stop(running).catch((cause) => toast.error(readable(cause)))}
                      >
                        <Square className="size-3 fill-current" aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        aria-label="Send message"
                        className={`${styles.assistantSend} disabled:opacity-50`}
                        disabled={
                          !ready ||
                          busy ||
                          uploading ||
                          invalidInputs ||
                          unknownAgent ||
                          !!contextProblem ||
                          (!assistant.message.trim() && !selectedAgent)
                        }
                        onClick={() => void send()}
                      >
                        <ArrowUp className="size-4.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ))}
      </Tabs>
    </div>
  );
}

/** Assistant reply text that types itself out when it arrives live; history shows at once. */
function TypedMarkdown({
  typingKey,
  markdown,
  ...props
}: { typingKey: string | null; markdown: string } & Omit<ComponentProps<typeof MarkdownPreview>, "markdown">) {
  return <MarkdownPreview markdown={useTypedText(markdown, typingKey)} {...props} />;
}
