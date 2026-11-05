"use client";

import { appHref } from "@/lib/routing/subdomains.ts";
import { useRef, useState, type ReactNode } from "react";
import { Eye, History, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  ActionMenuButton,
  BackButton,
  Button,
  DropdownMenuItem,
  DropdownMenuSeparator,
  TooltipProvider,
} from "@/components/ui/index.tsx";

import styles from "./BlogEditor.module.css";
import { AssistantHeader } from "@/components/assistant/AssistantHeader";
import assistantStyles from "@/components/assistant/Assistant.module.css";

interface BlogEditorShellProps {
  title: string;
  children: ReactNode;
  toolbar: ReactNode;
  settings: ReactNode;
  history?: ReactNode;
  assistant?: (onClose: () => void) => ReactNode;
  initialAssistantOpen?: boolean;
  outline?: ReactNode;
  publicationActions?: ReactNode;
  status: string;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
  onSave: () => void;
  onPreview: () => void;
  onReview: () => void;
  canEdit?: boolean;
  canPublish?: boolean;
  backHref?: string;
  initialSettingsOpen?: boolean;
  busy?: boolean;
}

/** The parent owns editor content and persistence; this shell never starts saves itself. */
export function BlogEditorShell({
  title,
  children,
  toolbar,
  settings,
  history,
  assistant,
  initialAssistantOpen = false,
  outline,
  publicationActions,
  status,
  saveState,
  onSave,
  onPreview,
  onReview,
  canEdit = false,
  canPublish = false,
  backHref = appHref("/admin/blog"),
  initialSettingsOpen = false,
  busy = false,
}: BlogEditorShellProps) {
  const [panel, setPanelState] = useState<"assistant" | "settings" | "history" | null>(
    initialSettingsOpen ? "settings" : initialAssistantOpen ? "assistant" : null,
  );
  const [settingsPanel, setSettingsPanel] = useState<"settings" | "history">("settings");
  function setPanel(next: typeof panel) {
    if (next === "settings" || next === "history") setSettingsPanel(next);
    setPanelState(next);
  }
  const settingsOpen = panel === "settings" || panel === "history";
  const assistantButton = useRef<HTMLButtonElement>(null);
  const mobileAssistantButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const mobileHistoryButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const mobileSettingsButton = useRef<HTMLButtonElement>(null);
  const saving = saveState === "saving";
  const needsRecovery = saveState === "error" || saveState === "conflict";

  function closeSettings() {
    setPanel(null);
    const desktop = panel === "assistant" ? assistantButton : panel === "history" ? historyButton : settingsButton;
    const mobile =
      panel === "assistant" ? mobileAssistantButton : panel === "history" ? mobileHistoryButton : mobileSettingsButton;
    const button = desktop.current?.getClientRects().length ? desktop.current : mobile.current;
    button?.focus();
  }

  return (
    <TooltipProvider>
      <section
        className={styles.shell}
        data-settings-open={settingsOpen}
        data-panel-open={panel !== null}
        data-assistant-open={panel === "assistant"}
        aria-label="Post editor"
        onKeyDown={(event) => {
          if (event.key === "Escape" && panel !== null && !event.defaultPrevented) {
            event.preventDefault();
            closeSettings();
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (canEdit && !saving && !busy && saveState !== "conflict") onSave();
          }
        }}
      >
        <header className={styles.header}>
          <BackButton href={backHref} label="Back to posts" className="self-center" />
          <h1 className={styles.title}>{title || "Untitled post"}</h1>
          <div className={styles.actions}>
            <div className={styles.panelActions} role="group" aria-label="Editor panels">
              {assistant && (
                <Button
                  size="sm"
                  ref={assistantButton}
                  variant="ghost"
                  aria-expanded={panel === "assistant"}
                  aria-controls="blog-assistant"
                  onClick={() => setPanel(panel === "assistant" ? null : "assistant")}
                >
                  <Sparkles aria-hidden="true" />
                  Assistant
                </Button>
              )}
              {history && (
                <Button
                  size="sm"
                  ref={historyButton}
                  variant="ghost"
                  aria-expanded={panel === "history"}
                  aria-controls="blog-post-settings"
                  onClick={() => setPanel(panel === "history" ? null : "history")}
                >
                  <History aria-hidden="true" />
                  History
                </Button>
              )}
              <Button
                size="sm"
                ref={settingsButton}
                variant="ghost"
                aria-label="Post settings"
                aria-expanded={panel === "settings"}
                aria-controls="blog-post-settings"
                onClick={() => setPanel(panel === "settings" ? null : "settings")}
              >
                <SlidersHorizontal aria-hidden="true" />
                Settings
              </Button>
            </div>
            <div role="group" aria-label="Publishing actions">
              <ActionMenuButton
                label="Preview & actions"
                menuLabel="Preview and post actions"
                size="sm"
                variant={canPublish ? "default" : "outline"}
                primaryAction={
                  canPublish
                    ? {
                        label: (
                          <>
                            <span className="sm:hidden">Review</span>
                            <span className="hidden sm:inline">Review & publish</span>
                          </>
                        ),
                        ariaLabel: "Review & publish",
                        onClick: onReview,
                        disabled: busy || needsRecovery,
                      }
                    : undefined
                }
                contentProps={{
                  className: "w-auto min-w-0 max-w-[calc(100vw-2rem)]",
                  onEscapeKeyDown: (event) => event.stopPropagation(),
                }}
              >
                <DropdownMenuItem onSelect={onPreview} disabled={busy || saveState === "conflict"}>
                  <Eye aria-hidden="true" />
                  Preview draft
                </DropdownMenuItem>
                {publicationActions && <DropdownMenuSeparator />}
                {publicationActions}
              </ActionMenuButton>
            </div>
          </div>
          <nav className={styles.mobileTabs} aria-label="Editor stages">
            <Button
              size="sm"
              variant={panel === null ? "default" : "outline"}
              aria-pressed={panel === null}
              onClick={() => setPanel(null)}
            >
              Write
            </Button>
            {assistant && (
              <Button
                size="sm"
                ref={mobileAssistantButton}
                variant={panel === "assistant" ? "default" : "outline"}
                aria-pressed={panel === "assistant"}
                aria-controls="blog-assistant"
                onClick={() => setPanel("assistant")}
              >
                Assistant
              </Button>
            )}
            <Button
              size="sm"
              ref={mobileSettingsButton}
              variant={panel === "settings" ? "default" : "outline"}
              aria-pressed={panel === "settings"}
              aria-controls="blog-post-settings"
              onClick={() => setPanel("settings")}
            >
              Settings
            </Button>
            {history && (
              <Button
                size="sm"
                ref={mobileHistoryButton}
                variant={panel === "history" ? "default" : "outline"}
                aria-pressed={panel === "history"}
                aria-controls="blog-post-settings"
                onClick={() => setPanel("history")}
              >
                History
              </Button>
            )}
          </nav>
        </header>
        <div className={styles.workspace} data-blog-editor-workspace="true">
          <div className={styles.canvas}>
            <div className={styles.toolbar} aria-label="Formatting tools">
              {toolbar}
            </div>
            <div className={styles.scroll} data-blog-editor-scroll="true">
              <div className={styles.article}>{children}</div>
            </div>
          </div>
          {outline && <div className={styles.outline}>{outline}</div>}
          {assistant && (
            <aside
              id="blog-assistant"
              data-open={panel === "assistant"}
              aria-hidden={panel !== "assistant"}
              inert={panel !== "assistant"}
              className={`${styles.sidePanel} ${styles.assistant}`}
              aria-label="Assistant"
            >
              {assistant(closeSettings)}
            </aside>
          )}
          <aside
            id="blog-post-settings"
            data-open={settingsOpen}
            aria-hidden={!settingsOpen}
            inert={!settingsOpen}
            className={styles.sidePanel}
            aria-label={settingsPanel === "history" ? "Revision history" : "Post settings"}
          >
            <div className={assistantStyles.sidePanelContent}>
              <AssistantHeader
                title={settingsPanel === "history" ? "Revision history" : "Post settings"}
                closeLabel={settingsPanel === "history" ? "Close revision history" : "Close post settings"}
                onClose={closeSettings}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {settingsPanel === "history" ? history : settings}
              </div>
            </div>
          </aside>
        </div>
        <footer className={styles.footer}>
          <p
            role={needsRecovery ? "alert" : "status"}
            className={needsRecovery ? "text-destructive" : "text-muted-foreground"}
          >
            {status}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">
              {canEdit ? "Autosave on" : "Read only"}
              <span className="hidden sm:inline"> · Ctrl / Cmd + S to save</span>
            </span>
            {canEdit && (
              <Button
                size="xs"
                variant="ghost"
                loading={saving}
                disabled={busy || saveState === "conflict"}
                onClick={onSave}
              >
                {saveState === "error" ? "Retry save" : "Save draft"}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </TooltipProvider>
  );
}
