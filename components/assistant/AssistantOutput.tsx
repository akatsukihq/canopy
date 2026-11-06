"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  Globe,
  FolderOpen,
  ImageIcon,
  MessageSquare,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import {
  BackButton,
  Button,
  ContentState,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  toast,
} from "@/components/ui/index.tsx";
import { RichContent } from "@/components/content/RichContent";
import type { AssistantAttachment, AssistantExecutionSummary } from "@/lib/assistant/types";
import type { AssistantAgent, AssistantIntegrationUI } from "./types";
import { assistantApiBase, assistantRequest } from "@/lib/assistant/client";
import { ReportView } from "./ReportView";
import { ChangesetPreview } from "./ChangesetPreview";
import styles from "./AssistantOutput.module.css";
import { AssistantProgress } from "./AssistantProgress";
import { ApprovalCard } from "./ApprovalCard";

function savedTime(createdAt: string) {
  return new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function elapsedTime(createdAt: string, completedAt: string | null) {
  if (!completedAt) return null;
  const milliseconds = Date.parse(completedAt) - Date.parse(createdAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  if (milliseconds < 1000) return "<1s";
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours && `${hours}h`, minutes && `${minutes}m`, seconds % 60 && `${seconds % 60}s`].filter(Boolean).join(" ");
}

function SavedArtifactCard({
  label,
  summary,
  agent,
  createdAt,
  stale = false,
  inLibrary = false,
  onOpen,
}: {
  label: string;
  summary: string;
  agent?: AssistantAgent;
  createdAt: string;
  stale?: boolean;
  inLibrary?: boolean;
  onOpen: () => void;
}) {
  const Icon = agent?.icon ?? Sparkles;
  return (
    <Button
      variant="outline"
      className={`${styles.artifactCard} ${inLibrary ? styles.libraryCard : ""}`}
      onClick={onOpen}
      aria-label={`Open ${label}`}
    >
      <span className={styles.cardHeading}>
        <ClipboardList className="size-4" aria-hidden="true" />
        <span>{label}</span>
        <span className={styles.cardChevron}>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </span>
      <span className={styles.cardSummary}>{summary}</span>
      <span className={styles.cardMeta}>
        <Icon className="size-3.5" aria-hidden="true" />
        <span className={styles.cardOrigin}>
          {agent?.name ?? "Saved output"} · <time dateTime={createdAt}>{savedTime(createdAt)}</time>
        </span>
        <span className={stale ? styles.stale : styles.ready}>
          {stale ? (
            "Content changed"
          ) : (
            <>
              <span aria-hidden="true" />
              Ready
            </>
          )}
        </span>
      </span>
    </Button>
  );
}

export function AssistantRunCard({
  execution,
  integration,
  busy,
  onOpen,
  onRetry,
  onNewRequest,
  onRefresh,
  onCopy,
  onUse,
  onApproval,
}: {
  execution: AssistantExecutionSummary;
  integration: AssistantIntegrationUI;
  busy: boolean;
  onOpen: (id: string) => void;
  onRetry: (id: string) => void;
  onNewRequest: () => void;
  onCopy: (id: string) => void;
  onUse: (id: string) => void;
  onRefresh: () => void;
  onApproval?: (approved: boolean, reason?: string) => void;
}) {
  const activityId = useId();
  const [activityOpen, setActivityOpen] = useState(false);
  const metadata = integration.agents.find((agent) => agent.id === execution.agentId);
  const agent = metadata?.name ?? "Agent";
  const AgentIcon = metadata?.icon ?? Sparkles;
  const stale = integration.executionStale(execution);
  const active = ["running", "queued"].includes(execution.status);
  const unavailable = !!execution.expiresAt && Date.parse(execution.expiresAt) <= Date.now();
  const duration = elapsedTime(execution.createdAt, execution.completedAt);
  return (
    <article className={styles.run} data-agent-run={execution.id} tabIndex={-1}>
      {execution.requestMessage && !unavailable && (
        <div className={styles.userRequest} aria-label={`Request to ${agent}`}>
          <span className={styles.requestAgent}>
            <AgentIcon className="size-3.5" aria-hidden="true" />
            <span>{agent}</span>
          </span>{" "}
          {execution.requestMessage}
        </div>
      )}
      <div className={styles.executionActivity}>
        <Button
          variant="input-icon"
          size="xs"
          className={styles.activityToggle}
          aria-expanded={activityOpen}
          aria-controls={activityId}
          onClick={() => setActivityOpen((open) => !open)}
        >
          {activityOpen ? <ChevronDown /> : <ChevronRight />}
          View activity
        </Button>
        {activityOpen && (
          <ol className={styles.executionEvents} id={activityId}>
            <li>
              <span>Request accepted</span>
              <time dateTime={execution.createdAt}>{savedTime(execution.createdAt)}</time>
            </li>
            {execution.completedAt ? (
              <li>
                <span>
                  {execution.status === "completed"
                    ? "Completed"
                    : execution.status === "cancelled"
                      ? "Stopped"
                      : execution.status === "failed"
                        ? "Failed"
                        : "Finished"}
                  {duration && `${execution.status === "completed" ? " in " : " after "}${duration}`}
                </span>
                <time dateTime={execution.completedAt}>{savedTime(execution.completedAt)}</time>
              </li>
            ) : (
              <li>
                <span>
                  {execution.status === "queued"
                    ? "Queued"
                    : execution.status === "running"
                      ? "Working"
                      : execution.status === "unknown"
                        ? "Status unconfirmed"
                        : execution.status === "cancelled"
                          ? "Stopped"
                          : execution.status === "failed"
                            ? "Failed"
                            : "Completed"}
                </span>
              </li>
            )}
          </ol>
        )}
      </div>
      {execution.approval && !unavailable && (
        <ApprovalCard
          approval={execution.approval}
          pending={execution.status === "awaiting-approval"}
          busy={busy || !onApproval}
          onRespond={(approved, reason) => onApproval?.(approved, reason)}
        />
      )}
      {execution.status === "awaiting-approval" && !unavailable ? null : execution.artifact && !unavailable ? (
        <>
          <SavedArtifactCard
            label={execution.artifact.label}
            summary={execution.artifact.summary}
            agent={metadata}
            createdAt={execution.createdAt}
            stale={stale}
            onOpen={() => onOpen(execution.artifact!.attachmentId)}
          />
          <div className={styles.secondaryActions}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Use ${execution.artifact.label}`}
                  disabled={busy}
                  onClick={() => onUse(execution.artifact!.attachmentId)}
                >
                  <ArrowUpRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Use output or preview draft</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Copy ${execution.artifact.label}`}
                  onClick={() => onCopy(execution.artifact!.attachmentId)}
                >
                  <Copy />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy complete output</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Repeat ${agent}`}
                  disabled={busy}
                  onClick={() => onRetry(execution.id)}
                >
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Prepare a new request with {agent}</TooltipContent>
            </Tooltip>
          </div>
        </>
      ) : (
        <div className={styles.activity}>
          {active && !unavailable ? (
            <AssistantProgress>
              {`${execution.status === "queued" ? "Starting" : "Working with"} ${agent}…`}
            </AssistantProgress>
          ) : (
            <p role="status" className={styles.activityStatus}>
              <span>
                {unavailable
                  ? "This result has expired"
                  : execution.status === "failed"
                    ? `${agent} couldn’t finish`
                    : execution.status === "cancelled"
                      ? "Stopped"
                      : execution.status === "unknown"
                        ? "Connection interrupted"
                        : "Saved report unavailable"}
              </span>
            </p>
          )}
          <p className="text-caption text-muted-foreground">
            {execution.errorMessage ||
              (active
                ? ""
                : execution.status === "unknown"
                  ? "Status unconfirmed. Check before starting another run."
                  : "No report created. Your content is unchanged.")}
          </p>
          {active ? null : execution.status === "unknown" ? (
            <Button variant="outline" size="xs" onClick={onRefresh}>
              Check status
            </Button>
          ) : unavailable ? (
            <Button variant="outline" size="xs" disabled={busy} onClick={onNewRequest}>
              Prepare new request
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Retry ${agent}`}
                  disabled={busy}
                  onClick={() => onRetry(execution.id)}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retry {agent}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </article>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy. Select the report text and copy it manually.");
  }
}

function sourceUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function SourceAttachment({ file }: { file: AssistantAttachment }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const link = file.type === "link" ? sourceUrl(file.data.url) : null;
  const expired = !!file.expiresAt && Date.parse(file.expiresAt) <= Date.now();
  const imageUrl = file.type === "image" && !expired ? sourceUrl(file.data.url)?.href : undefined;
  const [imageFailed, setImageFailed] = useState(false);
  const format = file.data.mimeType?.split("/").at(-1)?.toUpperCase() ?? "Image";
  const description = expired
    ? "Expired"
    : file.status !== "ready"
      ? file.status
      : link
        ? `${link.hostname} · Reference link`
        : `${format}${file.data.sizeBytes ? ` · ${Math.ceil(file.data.sizeBytes / 1024)} KB` : ""}`;
  const content = (
    <>
      <span className={styles.thumbnail}>
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt="" onError={() => setImageFailed(true)} />
        ) : file.type === "link" ? (
          <Globe className="size-6" aria-hidden="true" />
        ) : (
          <ImageIcon className="size-6" aria-hidden="true" />
        )}
      </span>
      <span className={styles.sourceText}>
        <span>{file.label}</span>
        <small>{description}</small>
      </span>
      {link ? (
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden="true" />
      )}
    </>
  );
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {link && !expired ? (
            <Button asChild variant="outline" className={styles.sourceRow}>
              <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.label}`}>
                {content}
              </a>
            </Button>
          ) : (
            <Button
              variant="outline"
              className={styles.sourceRow}
              onClick={() => setPreviewOpen(true)}
              aria-label={`View ${file.label}`}
            >
              {content}
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{file.label}</TooltipContent>
      </Tooltip>
      <AlertDialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{file.label}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {imageUrl && !imageFailed ? (
            <img
              className={styles.sourcePreview}
              src={imageUrl}
              alt={file.label}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {expired ? "This attachment has expired." : "A preview is not available for this saved attachment."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Sources is read-only. Applying and handoffs are available from agent results in Chat. */
export function AssistantSources({
  active,
  integration,
  threadId,
  artifactId,
  onOpen,
  onShowRun,
  refreshKey,
}: {
  active: boolean;
  integration: AssistantIntegrationUI;
  threadId: string | null;
  artifactId: string | null;
  onOpen: (id: string | null) => void;
  onShowRun: (id: string) => void;
  refreshKey: string;
}) {
  const [pages, setPages] = useState<{ artifacts: AssistantAttachment[]; sources: AssistantAttachment[] }>({
    artifacts: [],
    sources: [],
  });
  const [cursors, setCursors] = useState<{ artifacts: string | null; sources: string | null }>({
    artifacts: null,
    sources: null,
  });
  const [selected, setSelected] = useState<{ attachment: AssistantAttachment; html?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const base = `${assistantApiBase(integration.key)}/threads/${threadId}/attachments`;
  useEffect(() => {
    let live = true;
    setSelected(null);
    setError("");
    setLoading(true);
    if (!threadId) {
      setPages({ artifacts: [], sources: [] });
      setCursors({ artifacts: null, sources: null });
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        if (artifactId) {
          const value = await assistantRequest<{ attachment: AssistantAttachment; html?: string }>(
            `${base}/${artifactId}`,
          );
          if (live) {
            setSelected(value);
          }
        } else {
          const [artifacts, sources] = await Promise.all(
            ["artifacts", "sources"].map((kind) =>
              assistantRequest<{ attachments: AssistantAttachment[]; nextCursor: string | null }>(
                `${base}?kind=${kind}`,
              ),
            ),
          );
          if (live) {
            setPages({ artifacts: artifacts.attachments, sources: sources.attachments });
            setCursors({ artifacts: artifacts.nextCursor, sources: sources.nextCursor });
          }
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load Sources.");
      } finally {
        if (live) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [threadId, artifactId, base, refreshKey, reload]);
  useEffect(() => {
    if (active && !loading && artifactId) heading.current?.focus({ preventScroll: true });
  }, [active, loading, artifactId]);
  async function more() {
    if (loadingMore) return;
    const kinds = (["artifacts", "sources"] as const).filter((kind) => cursors[kind]);
    if (!kinds.length) return;
    setLoadingMore(true);
    try {
      const nextPages = await Promise.all(
        kinds.map(async (kind) => ({
          kind,
          ...(await assistantRequest<{ attachments: AssistantAttachment[]; nextCursor: string | null }>(
            `${base}?kind=${kind}&cursor=${encodeURIComponent(cursors[kind]!)}`,
          )),
        })),
      );
      for (const page of nextPages) {
        setPages((previous) => ({
          ...previous,
          [page.kind]: [
            ...previous[page.kind],
            ...page.attachments.filter((file) => !previous[page.kind].some((old) => old.id === file.id)),
          ],
        }));
        setCursors((previous) => ({ ...previous, [page.kind]: page.nextCursor }));
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not load more items.");
    } finally {
      setLoadingMore(false);
    }
  }
  const items = [...pages.artifacts, ...pages.sources].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const hasMore = !!(cursors.artifacts || cursors.sources);
  const model = selected ? integration.artifact(selected.attachment, selected.html) : undefined;
  const supported = !!model?.supported;
  const expired = !!selected?.attachment.expiresAt && Date.parse(selected.attachment.expiresAt) <= Date.now();
  const showMessageAction = selected?.attachment.runId ? (
    <Button
      className={!expired && supported ? styles.reportAction : undefined}
      size="sm"
      variant="outline"
      onClick={() => onShowRun(selected.attachment.runId!)}
    >
      <MessageSquare />
      Show message
    </Button>
  ) : null;
  const reportText =
    !loading && !error && !expired && selected?.attachment.id === artifactId
      ? supported
        ? `${selected.attachment.label}\n\n${model?.text ?? ""}`
        : JSON.stringify(selected.attachment.data, null, 2)
      : null;
  function downloadReport() {
    if (reportText === null || !selected) return;
    try {
      const url = URL.createObjectURL(
        new Blob([reportText], { type: supported ? "text/plain;charset=utf-8" : "application/json" }),
      );
      const anchor = globalThis.document.createElement("a");
      const name =
        selected.attachment.label
          .replace(/[^\p{L}\p{N}._-]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 100) || "report";
      anchor.href = url;
      anchor.download = `${name}.${supported ? "txt" : "json"}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Could not download the report. Try again or copy it instead.");
    }
  }
  return (
    <section className={styles.library} aria-label="Thread Sources">
      {artifactId && (
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <BackButton label="Back to sources" onClick={() => onOpen(null)} />
          <h3 className={styles.reportTitle} ref={heading} tabIndex={-1}>
            {selected?.attachment.id === artifactId ? selected.attachment.label : "Source"}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="input-icon"
                  size="icon-sm"
                  aria-label="Download report"
                  disabled={reportText === null}
                  onClick={downloadReport}
                >
                  <Download aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download report</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="input-icon"
                  size="icon-sm"
                  aria-label="Copy report"
                  disabled={reportText === null}
                  onClick={() => reportText !== null && void copy(reportText)}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy report</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      <div className={`${styles.scroll} ${artifactId ? "" : styles.inventory}`}>
        {loading ? (
          <AssistantProgress centered>Loading sources…</AssistantProgress>
        ) : error ? (
          <ContentState
            density="panel"
            state="error"
            headingLevel="h3"
            title="Couldn’t load sources"
            description={error}
            announcement="assertive"
            action={
              <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        ) : artifactId ? (
          selected && (
            <>
              {expired ? (
                <ContentState
                  density="panel"
                  state="unavailable"
                  headingLevel="h3"
                  title="This result has expired"
                  description="Return to chat to prepare a fresh request."
                  action={showMessageAction}
                />
              ) : supported ? (
                <>
                  {model?.stale && (
                    <p className="text-caption text-muted-foreground">This report describes an earlier version.</p>
                  )}
                  {model && <ReportView report={model.report} />}
                  {model?.document && (
                    <section className={styles.savedDocument}>
                      <h4>{model.document.title}</h4>
                      {model.document.html ? (
                        <RichContent html={model.document.html} className={styles.article} />
                      ) : (
                        <p>{model.document.text}</p>
                      )}
                    </section>
                  )}
                </>
              ) : (
                <ContentState
                  density="panel"
                  state="unavailable"
                  headingLevel="h3"
                  title="This output version is not supported"
                  description="You can download or copy its saved data."
                  action={showMessageAction}
                />
              )}
              {!expired && supported && showMessageAction}
            </>
          )
        ) : (
          <>
            {!items.length && (
              <ContentState
                className="my-auto"
                density="panel"
                headingLevel="h3"
                icon={<FolderOpen />}
                title="No sources yet"
                description="Added files, links, and agent outputs will appear here."
              />
            )}
            {items.map((file) =>
              file.type === "artifact" ? (
                <SavedArtifactCard
                  key={file.id}
                  label={file.label}
                  summary={file.data.artifactSummary?.summary ?? "Saved agent output"}
                  agent={integration.agents.find((agent) => agent.id === file.data.artifactSummary?.agentId)}
                  createdAt={file.createdAt}
                  inLibrary
                  onOpen={() => onOpen(file.id)}
                />
              ) : (
                <SourceAttachment key={file.id} file={file} />
              ),
            )}
            {hasMore && (
              <Button size="sm" variant="ghost" disabled={loadingMore} onClick={() => void more()}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function AssistantResultActions({
  attachment,
  html,
  integration,
  onBack,
  onAttach,
  onRetry,
}: {
  attachment: AssistantAttachment;
  html?: string;
  integration: AssistantIntegrationUI;
  onBack: () => void;
  onAttach: (id: string, agentId?: string, instruction?: string) => void;
  onRetry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [attachment.id]);
  const model = integration.artifact(attachment, html);
  if (!model.supported)
    return (
      <ContentState
        density="panel"
        state="unavailable"
        headingLevel="h3"
        title="Unsupported output"
        description="Open Sources to inspect its saved data."
        action={<BackButton label="Back to chat" onClick={onBack} />}
      />
    );
  const expired = !!attachment.expiresAt && Date.parse(attachment.expiresAt) <= Date.now();
  return (
    <section className={styles.library} aria-label="Agent result actions">
      <div className={styles.libraryHeader}>
        <BackButton label="Back to chat" onClick={onBack} />
        <h3 ref={heading} tabIndex={-1}>
          {attachment.label}
        </h3>
      </div>
      <div className={styles.scroll}>
        <ReportView report={model.report} />
        {expired && <p role="status">This result expired. Prepare a new request in chat.</p>}
        {model.changeset && <ChangesetPreview model={model.changeset} onRetry={onRetry} />}
        <Button
          variant="outline"
          disabled={expired}
          onClick={() => onAttach(attachment.id, model.handoff?.agentId, model.handoff?.instruction)}
        >
          {model.handoff?.label ?? "Attach to composer"}
        </Button>
      </div>
    </section>
  );
}
