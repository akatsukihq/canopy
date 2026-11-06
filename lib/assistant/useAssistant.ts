"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/index.tsx";
import type {
  AssistantAvailability,
  AssistantRun,
  AssistantThread,
  AssistantAttachment,
  AssistantThreadDetail,
  AssistantRunRequest,
  AssistantMessage,
  AssistantExecutionSummary,
  AssistantComposerSelection,
  AssistantExecutionMode,
  AssistantModels,
} from "@/lib/assistant/types";
import { AI_EFFORTS, type AIEffort } from "@/lib/ai/types";
import {
  assistantApiBase,
  assistantCacheKey,
  activeRun,
  assistantRequest,
  AssistantRequestError,
  AssistantStreamInterruptedError,
  cancelAssistantRun,
  streamAssistantRun,
} from "./client";
import { NEW_THREAD_TITLE } from "@/lib/assistant/types";
import { parseComposerContent } from "@/lib/assistant/composerDocument.ts";
import { sameComposerSelection } from "./composer.ts";

type AssistantSettings = Record<string, unknown>;
/** The picker's choice; unset fields fall back to the admin model and the agent's effort. */
export type AssistantModelChoice = { model?: string; effort?: AIEffort };
const MODEL_CHOICE_KEY = "smarttools.assistant.model";

function storedModelChoice(): AssistantModelChoice {
  try {
    const value = JSON.parse(localStorage.getItem(MODEL_CHOICE_KEY) ?? "{}") as Record<string, unknown>;
    return {
      ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
      ...(AI_EFFORTS.includes(value.effort as AIEffort) ? { effort: value.effort as AIEffort } : {}),
    };
  } catch {
    return {};
  }
}

function restoredAgentOffset(value: unknown): { agentOffset?: number } {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8000
    ? { agentOffset: value }
    : {};
}

function restoredComposerContent(value: unknown): Pick<AssistantComposerSelection, "content"> {
  const content = parseComposerContent(value);
  return content ? { content } : {};
}

export function useAssistant(integrationKey: string, resourceId: string | undefined, ownerId: string) {
  const apiBase = assistantApiBase(integrationKey);
  const base = `${apiBase}/threads`;
  const listUrl = `${base}${resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : ""}`;
  const storageKey = assistantCacheKey(ownerId, integrationKey, resourceId);
  const readStored = useCallback((suffix: string) => sessionStorage.getItem(`${storageKey}:${suffix}`), [storageKey]);
  const scopeVersion = useRef(0);
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState("new");
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  const [newSettings, setNewSettings] = useState<Record<string, AssistantSettings>>({});
  const newSettingsRef = useRef(newSettings);
  newSettingsRef.current = newSettings;
  const startingNew = useRef(false);
  const [details, setDetails] = useState<Record<string, AssistantThreadDetail>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [composerStates, setComposerStates] = useState<Record<string, AssistantComposerSelection>>({});
  const composerStatesRef = useRef(composerStates);
  composerStatesRef.current = composerStates;
  const [availability, setAvailability] = useState<AssistantAvailability | null>(null);
  const [models, setModels] = useState<AssistantModels | null>(null);
  const [modelChoice, setModelChoiceState] = useState<AssistantModelChoice>({});
  const modelChoiceRef = useRef(modelChoice);
  modelChoiceRef.current = modelChoice;
  useEffect(() => {
    setModelChoiceState(storedModelChoice());
  }, []);
  const setModelChoice = useCallback((next: AssistantModelChoice) => {
    setModelChoiceState(next);
    try {
      localStorage.setItem(MODEL_CHOICE_KEY, JSON.stringify(next));
    } catch {
      // The choice still applies for this page.
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const alive = useRef(true);
  const controllers = useRef(new Map<string, AbortController>());
  const [streams, setStreams] = useState<Record<string, { run: AssistantRun; text: string; reasoning?: string }>>({});
  const [freshRunIds, setFreshRunIds] = useState<string[]>([]);
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const creating = useRef(new Map<string, Promise<AssistantThread>>());
  const createdThreads = useRef(new Map<string, string>());
  const pending = useRef<Record<string, AssistantRunRequest>>({});
  const locks = useRef(new Set<string>());
  const threadLoads = useRef<Record<string, number>>({});
  const refreshVersion = useRef(0);
  const settingsQueue = useRef<Record<string, Promise<void>>>({});
  const clearing = useRef(new Set<string>());

  const currentScope = () => selectedRef.current ?? draftScopeRef.current;
  const isDraftScope = (id: string) => id === "new" || id.startsWith("new:");
  const resolvedScope = (id: string) => createdThreads.current.get(id) ?? id;

  const remember = useCallback(
    (id: string | null) => {
      selectedRef.current = id;
      setSelected(id);
      setError("");
      try {
        sessionStorage.setItem(`${storageKey}:selected`, id ?? "");
      } catch {
        /* Storage can be unavailable. */
      }
    },
    [storageKey],
  );
  const loadThread = useCallback(
    async (id: string) => {
      const scope = scopeVersion.current;
      const version = (threadLoads.current[id] ?? 0) + 1;
      threadLoads.current[id] = version;
      const knownRuns = new Set(detailsRef.current[id]?.runs.map((run) => run.id));
      const knownMessages = new Map(detailsRef.current[id]?.messages.map((message) => [message.id, message]));
      const detail = await assistantRequest<AssistantThreadDetail>(`${base}/${id}`);
      if (!alive.current || scopeVersion.current !== scope || threadLoads.current[id] !== version) return;
      setThreads((value) =>
        value.map((thread) => (thread.id === id ? { ...thread, title: detail.thread.title } : thread)),
      );
      setDetails((value) => ({
        ...value,
        [id]: {
          ...detail,
          messages: [
            ...detail.messages.map((message) => {
              const current = value[id]?.messages.find((entry) => entry.id === message.id);
              return current && (current !== knownMessages.get(message.id) || current.updatedAt > message.updatedAt)
                ? current
                : message;
            }),
            ...(value[id]?.messages ?? []).filter(
              (message) =>
                !detail.messages.some((entry) => entry.id === message.id) &&
                (message.meta.pending || message.meta.failed || message !== knownMessages.get(message.id)),
            ),
          ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          executions: [
            ...(detail.executions ?? []).map((entry) => {
              const current = value[id]?.executions?.find((old) => old.id === entry.id);
              return current &&
                (current.updatedAt > entry.updatedAt ||
                  (!activeRun(current.status) && activeRun(entry.status)) ||
                  (current.status === "unknown" && ["queued", "running"].includes(entry.status)))
                ? current
                : entry;
            }),
            ...(value[id]?.executions ?? []).filter(
              (entry) => !detail.executions?.some((server) => server.id === entry.id),
            ),
          ],
          runs: [
            ...detail.runs.map((run) => {
              const current = value[id]?.runs.find((entry) => entry.id === run.id);
              return current &&
                (current.updatedAt > run.updatedAt ||
                  (!activeRun(current.status) && activeRun(run.status)) ||
                  (current.status === "unknown" && ["queued", "running"].includes(run.status)))
                ? current
                : run;
            }),
            ...(value[id]?.runs ?? []).filter(
              (run) => !knownRuns.has(run.id) && !detail.runs.some((entry) => entry.id === run.id),
            ),
          ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        },
      }));
      if (detail.runs.some((run) => run.request.clientRequestId === pending.current[id]?.clientRequestId))
        delete pending.current[id];
      setDrafts((value) => {
        if (id in value) return value;
        let local: string | null = null;
        try {
          local = readStored(`draft:${id}`);
        } catch {
          /* Optional recovery. */
        }
        return { ...value, [id]: local ?? detail.thread.composerDraft ?? "" };
      });
      setComposerStates((value) => {
        if (id in value) return value;
        let saved = detail.thread.composerState ?? { attachmentIds: [] };
        try {
          const raw = JSON.parse(readStored(`selection:${id}`) ?? "null");
          if (
            raw &&
            Array.isArray(raw.attachmentIds) &&
            raw.attachmentIds.every((entry: unknown) => typeof entry === "string")
          )
            saved = {
              agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
              ...restoredAgentOffset(raw.agentOffset),
              ...restoredComposerContent(raw.content),
              attachmentIds: raw.attachmentIds,
            };
        } catch {
          /* Server restoration remains available. */
        }
        return { ...value, [id]: saved };
      });
      const { enabled, provider, capabilities, reason } = detail;
      setAvailability({ enabled, provider, capabilities, reason });
    },
    [base, storageKey, readStored],
  );
  const refresh = useCallback(async () => {
    setFreshRunIds([]);
    const version = ++refreshVersion.current;
    setLoading(true);
    setHistoryStatus("loading");
    setError("");
    try {
      const [config, history] = await Promise.allSettled([
        assistantRequest<AssistantAvailability & Partial<AssistantModels>>(`${apiBase}/config`),
        assistantRequest<{ threads: AssistantThread[] }>(listUrl),
      ]);
      if (!alive.current || refreshVersion.current !== version) return;
      if (config.status === "fulfilled") {
        const { defaultModel, models: list, ...value } = config.value;
        setAvailability(value);
        setModels(
          defaultModel !== undefined && list
            ? {
                provider: value.provider,
                defaultModel,
                models: list.map((model) => ({ ...model, name: model.name || model.id })),
              }
            : null,
        );
      }
      if (history.status === "rejected") {
        const message =
          history.reason instanceof Error ? history.reason.message : "Could not load private conversations.";
        setHistoryStatus("error");
        setError(message);
        if (threadsRef.current.length) toast.error(message);
        return;
      }
      const list = history.value;
      setThreads(list.threads);
      setHistoryStatus("ready");
      setDetails((value) =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([id]) => id === "new" || id.startsWith("new:") || list.threads.some((thread) => thread.id === id),
          ),
        ),
      );
      let id = selectedRef.current ?? new URLSearchParams(window.location.search).get("thread");
      try {
        id ??= readStored("selected");
      } catch {
        /* Optional selection restoration. */
      }
      id = startingNew.current
        ? null
        : list.threads.some((thread) => thread.id === id)
          ? id
          : (list.threads[0]?.id ?? null);
      remember(id);
      if (config.status === "rejected")
        setError(config.reason instanceof Error ? config.reason.message : "Could not load assistant settings.");
      if (id) await loadThread(id);
    } catch (cause) {
      if (alive.current && refreshVersion.current === version)
        setError(cause instanceof Error ? cause.message : "Could not load private conversations.");
    } finally {
      if (alive.current && refreshVersion.current === version) setLoading(false);
    }
  }, [apiBase, base, listUrl, loadThread, remember, storageKey, readStored]);
  useEffect(() => {
    alive.current = true;
    scopeVersion.current++;
    startingNew.current = false;
    creating.current.clear();
    createdThreads.current.clear();
    settingsQueue.current = {};
    locks.current.clear();
    controllers.current.clear();
    clearing.current.clear();
    setSubmitting({});
    setAvailability(null);
    threadLoads.current = {};
    setNewSettings({});
    newSettingsRef.current = {};
    draftScopeRef.current = "new";
    setDraftScope("new");
    selectedRef.current = null;
    threadsRef.current = [];
    detailsRef.current = {};
    draftsRef.current = {};
    composerStatesRef.current = {};
    pending.current = {};
    setThreads([]);
    setDetails({});
    setDrafts({});
    setComposerStates({});
    setSelected(null);
    setStreams({});
    setFreshRunIds([]);
    try {
      const local = readStored("draft:new");
      if (local !== null) setDrafts((value) => ("new" in value ? value : { ...value, new: local }));
      const raw = JSON.parse(readStored("selection:new") ?? "null");
      if (raw && Array.isArray(raw.attachmentIds) && raw.attachmentIds.every((id: unknown) => typeof id === "string"))
        setComposerStates((value) =>
          "new" in value
            ? value
            : {
                ...value,
                new: {
                  agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
                  ...restoredAgentOffset(raw.agentOffset),
                  ...restoredComposerContent(raw.content),
                  attachmentIds: raw.attachmentIds,
                },
              },
        );
    } catch {
      /* Optional draft recovery. */
    }
    void refresh();
    return () => {
      alive.current = false;
      scopeVersion.current++;
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, [refresh, storageKey, readStored]);

  function updateRun(run: AssistantRun, localMessageId?: string, streamedText = "") {
    if (!run.threadId) return;
    const id = run.threadId;
    setDetails((value) => {
      const detail = value[id];
      if (!detail) return value;
      const current = detail.runs.find((entry) => entry.id === run.id);
      if (
        current &&
        (current.updatedAt > run.updatedAt ||
          (!activeRun(current.status) && activeRun(run.status)) ||
          (current.status === "unknown" && ["queued", "running"].includes(run.status)))
      )
        return value;
      const runs = [...detail.runs.filter((entry) => entry.id !== run.id), run].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const executions =
        run.executionMode === "standalone"
          ? [
              ...(detail.executions ?? []).filter((entry) => entry.id !== run.id),
              {
                id: run.id,
                agentId: run.request.agentId,
                requestMessage: run.request.message,
                operation: run.operation,
                executionMode: run.executionMode,
                status: run.status,
                label: run.response?.artifact?.label ?? "Agent request",
                artifact: run.response?.artifact,
                errorMessage: run.errorMessage,
                approval: run.approval,
                createdAt: run.createdAt,
                updatedAt: run.updatedAt,
                completedAt: run.completedAt,
                expiresAt: new Date(Date.parse(run.createdAt) + 30 * 86400000).toISOString(),
              } satisfies AssistantExecutionSummary,
            ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : detail.executions;
      let messages = detail.messages;
      if (run.executionMode === "conversational") {
        const upsert = (message: AssistantMessage, replacedId = message.id) => {
          const index = messages.findIndex((entry) => entry.id === replacedId || entry.id === message.id);
          const next = messages.filter((entry) => entry.id !== replacedId && entry.id !== message.id);
          next.splice(index < 0 ? next.length : index, 0, message);
          messages = next;
        };
        if (run.inputMessageId) {
          const previous = messages.find((message) => message.id === run.inputMessageId);
          upsert(
            previous ?? {
              id: run.inputMessageId,
              threadId: id,
              runId: null,
              role: "user",
              parts: [
                { type: "text", text: run.request.message },
                ...(run.request.attachmentIds ?? []).map((attachmentId) => ({
                  type: "attachment" as const,
                  attachmentId,
                })),
              ],
              meta: {},
              createdAt: run.createdAt,
              updatedAt: run.createdAt,
            },
            localMessageId,
          );
        }
        if (run.assistantMessageId) {
          const previous = messages.find((message) => message.id === run.assistantMessageId);
          const text = run.response?.text ?? streamedText;
          upsert({
            id: run.assistantMessageId,
            threadId: id,
            runId: run.id,
            role: "assistant",
            parts: [
              ...(text
                ? [{ type: "text" as const, text }]
                : (previous?.parts.filter((part) => part.type === "text") ?? [])),
              ...(previous?.parts.filter((part) => part.type === "tool-call" || part.type === "tool-result") ?? []),
              ...(run.response?.proposals ?? []).map((proposal) => ({ type: "proposal" as const, proposal })),
            ],
            meta: previous?.meta ?? {},
            createdAt: previous?.createdAt ?? run.createdAt,
            updatedAt: run.updatedAt,
          });
        }
      }
      return {
        ...value,
        [id]: {
          ...detail,
          thread: { ...detail.thread, updatedAt: run.updatedAt },
          runs,
          executions,
          messages: [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          attachments: detail.attachments.map((file) =>
            run.executionMode === "conversational" &&
            run.inputMessageId &&
            file.type !== "artifact" &&
            run.request.attachmentIds?.includes(file.id)
              ? { ...file, messageId: run.inputMessageId }
              : file,
          ),
        },
      };
    });
    setThreads((value) =>
      value
        .map((thread) =>
          thread.id === id && thread.updatedAt <= run.updatedAt ? { ...thread, updatedAt: run.updatedAt } : thread,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  useEffect(() => {
    const abort = () => {
      for (const controller of controllers.current.values()) controller.abort();
    };
    window.addEventListener("pagehide", abort);
    return () => window.removeEventListener("pagehide", abort);
  }, []);

  function startNewThread() {
    setFreshRunIds([]);
    const next = `new:${crypto.randomUUID()}`;
    draftScopeRef.current = next;
    setDraftScope(next);
    startingNew.current = true;
    remember(null);
    draft("", next);
    composerState({ attachmentIds: [] }, next);
  }
  function emptyDetail(thread: AssistantThread): AssistantThreadDetail {
    return {
      enabled: availability?.enabled ?? false,
      provider: availability?.provider ?? "",
      capabilities: availability?.capabilities ?? {
        images: false,
        webSearch: false,
        structuredOutput: false,
        urlRetrieval: false,
      },
      reason: availability?.reason,
      thread,
      runs: [],
      messages: [],
      attachments: [],
      executions: [],
      executionsCursor: null,
    };
  }
  function adoptThread(thread: AssistantThread, sourceId: string, preserveDraft: boolean, localMessageId?: string) {
    setThreads((value) => [thread, ...value.filter((entry) => entry.id !== thread.id && entry.id !== sourceId)]);
    setDetails((value) => {
      const source = value[sourceId];
      const detail = value[thread.id] ?? (isDraftScope(sourceId) ? source : undefined) ?? emptyDetail(thread);
      const localMessages = source?.messages.filter((message) => message.id === localMessageId) ?? [];
      const next = {
        ...value,
        [thread.id]: {
          ...detail,
          thread,
          messages: [
            ...detail.messages,
            ...localMessages.filter((message) => !detail.messages.some((existing) => existing.id === message.id)),
          ].map((message) => ({ ...message, threadId: thread.id })),
        },
      };
      if (sourceId !== thread.id) delete next[sourceId];
      return next;
    });
    if (preserveDraft) {
      draft(draftsRef.current[sourceId] ?? "", thread.id);
      composerState(composerStatesRef.current[sourceId] ?? { attachmentIds: [] }, thread.id);
    }
    for (const [alias, resolved] of createdThreads.current)
      if (resolved === sourceId) createdThreads.current.set(alias, thread.id);
    createdThreads.current.set(sourceId, thread.id);
    if (currentScope() === sourceId) {
      startingNew.current = false;
      remember(thread.id);
    }
  }
  async function createThread(preserveDraft = false, message?: string, targetScope = currentScope()) {
    const existingId = resolvedScope(targetScope);
    if (!isDraftScope(existingId)) {
      const thread =
        detailsRef.current[existingId]?.thread ?? threadsRef.current.find((entry) => entry.id === existingId);
      if (!thread) throw new Error("Could not find this conversation. Refresh history and try again.");
      return thread;
    }
    const existingCreation = creating.current.get(targetScope);
    if (existingCreation) return existingCreation;
    const scope = scopeVersion.current;
    const creation = (async () => {
      const { thread } = await assistantRequest<{ thread: AssistantThread }>(listUrl, {
        settings: newSettingsRef.current[targetScope] ?? {},
      });
      if (!alive.current || scopeVersion.current !== scope)
        throw new DOMException("Assistant context changed.", "AbortError");
      adoptThread(thread, targetScope, preserveDraft);
      return thread;
    })();
    creating.current.set(targetScope, creation);
    try {
      return await creation;
    } finally {
      if (scopeVersion.current === scope && creating.current.get(targetScope) === creation)
        creating.current.delete(targetScope);
    }
  }
  async function choose(id: string) {
    const scope = scopeVersion.current;
    setFreshRunIds([]);
    startingNew.current = false;
    remember(id);
    try {
      await loadThread(id);
      if (alive.current && scopeVersion.current === scope && selectedRef.current === id) setError("");
    } catch (cause) {
      if (!alive.current || scopeVersion.current !== scope || selectedRef.current !== id) return;
      if (cause instanceof AssistantRequestError && cause.status === 404) {
        remember(null);
        await refresh();
      } else setError(cause instanceof Error ? cause.message : "Could not open this thread.");
    }
  }
  function draft(text: string, id = currentScope()) {
    draftsRef.current = { ...draftsRef.current, [id]: text };
    setDrafts((value) => ({ ...value, [id]: text }));
    try {
      if (!isDraftScope(id) || id === draftScopeRef.current)
        sessionStorage.setItem(`${storageKey}:draft:${isDraftScope(id) ? "new" : id}`, text);
    } catch {
      /* Keep in-memory draft. */
    }
  }
  function composerState(value: AssistantComposerSelection, id = currentScope()) {
    composerStatesRef.current = { ...composerStatesRef.current, [id]: value };
    setComposerStates((previous) => ({ ...previous, [id]: value }));
    try {
      if (!isDraftScope(id) || id === draftScopeRef.current)
        sessionStorage.setItem(`${storageKey}:selection:${isDraftScope(id) ? "new" : id}`, JSON.stringify(value));
    } catch {
      /* Optional recovery. */
    }
  }
  async function loadExecutions() {
    const scope = scopeVersion.current;
    const id = selectedRef.current;
    if (!id) return;
    const cursor = detailsRef.current[id]?.executionsCursor;
    if (!cursor) return;
    const page = await assistantRequest<{ executions: AssistantExecutionSummary[]; nextCursor: string | null }>(
      `${base}/${id}?view=results&cursor=${encodeURIComponent(cursor)}`,
    );
    if (!alive.current || scopeVersion.current !== scope) return;
    setDetails((all) =>
      all[id]
        ? {
            ...all,
            [id]: {
              ...all[id],
              executions: [
                ...(all[id].executions ?? []),
                ...page.executions.filter((entry) => !all[id].executions?.some((old) => old.id === entry.id)),
              ],
              executionsCursor: page.nextCursor,
            },
          }
        : all,
    );
  }
  async function settings(value: AssistantSettings, composerDraft?: string, id = selected) {
    const scope = scopeVersion.current;
    if (!id) {
      const key = draftScopeRef.current;
      newSettingsRef.current = { ...newSettingsRef.current, [key]: { ...newSettingsRef.current[key], ...value } };
      setNewSettings(newSettingsRef.current);
      return;
    }
    const save = (settingsQueue.current[id] ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!alive.current || scopeVersion.current !== scope) return;
        const result = await assistantRequest<{ thread: AssistantThread }>(
          `${base}/${id}`,
          { settings: value, ...(composerDraft === undefined ? {} : { composerDraft }) },
          "PATCH",
        );
        if (!alive.current || scopeVersion.current !== scope) return;
        setThreads((threads) => threads.map((thread) => (thread.id === id ? result.thread : thread)));
        setDetails((details) =>
          details[id] ? { ...details, [id]: { ...details[id], thread: result.thread } } : details,
        );
      });
    settingsQueue.current[id] = save;
    await save;
  }
  function pinVariant(threadId: string, messageId: string, runId: string | undefined) {
    setDetails((value) => {
      const detail = value[threadId];
      if (!detail) return value;
      return {
        ...value,
        [threadId]: {
          ...detail,
          messages: detail.messages.map((message) => {
            if (message.id !== messageId) return message;
            const { activeRunId: _, ...meta } = message.meta;
            return { ...message, meta: runId ? { ...meta, activeRunId: runId } : meta };
          }),
        },
      };
    });
  }
  /** Shows another answer to the same question and makes it the one sent as context. */
  async function selectVariant(messageId: string, runId: string) {
    const id = selectedRef.current;
    if (!id) return;
    const previous = detailsRef.current[id]?.messages.find((message) => message.id === messageId)?.meta.activeRunId;
    pinVariant(id, messageId, runId);
    try {
      await assistantRequest(`${base}/${id}`, { activeVariant: { messageId, runId } }, "PATCH");
    } catch (cause) {
      pinVariant(id, messageId, typeof previous === "string" ? previous : undefined);
      throw cause;
    }
  }
  async function saveDraft(composerDraft: string, id: string) {
    const scope = scopeVersion.current;
    if (clearing.current.has(id)) return;
    try {
      const save = (settingsQueue.current[id] ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          if (!alive.current || scopeVersion.current !== scope) return;
          await assistantRequest(
            `${base}/${id}`,
            { composerDraft, composerState: composerStatesRef.current[id] ?? { attachmentIds: [] } },
            "PATCH",
          );
        });
      settingsQueue.current[id] = save;
      await save;
    } catch (cause) {
      if (!alive.current || scopeVersion.current !== scope) return;
      if (selectedRef.current === id)
        setError("Your message is kept in this browser, but could not be synced. Refresh history before leaving.");
      throw cause;
    }
  }
  async function send(
    input: Omit<AssistantRunRequest, "threadId" | "clientRequestId" | "resourceId">,
    onCreated?: (run: AssistantRun) => void,
    targetScope = currentScope(),
    options: {
      executionMode?: AssistantExecutionMode;
      referenceLinks?: string[];
      onReferenceAdded?: (threadId: string, remaining: string[]) => void;
    } = {},
  ) {
    const scope = scopeVersion.current;
    let id = resolvedScope(targetScope);
    if (locks.current.has(id)) return;
    locks.current.add(id);
    // The server unpins on retry too, so the new answer shows as soon as it streams.
    if (input.inputMessageId) pinVariant(id, input.inputMessageId, undefined);
    if (resolvedScope(currentScope()) === id) setError("");
    setSubmitting((value) => ({ ...value, [id]: true }));
    const lockId = id;
    const conversational = options.executionMode !== "standalone";
    const submittedDraft = draftsRef.current[id] ?? "";
    const submittedSelection = composerStatesRef.current[id] ?? { attachmentIds: [] };
    let recoverySelection = submittedSelection;
    const clearComposer =
      conversational && !input.inputMessageId && (!submittedDraft.trim() || submittedDraft.trim() === input.message);
    const localMessageId = input.inputMessageId ?? crypto.randomUUID();
    const controller = new AbortController();
    let observedRun: AssistantRun | undefined;
    let streamedText = "";
    let streamedReasoning = "";
    let completed = false;
    controllers.current.set(id, controller);
    try {
      if (conversational) {
        const now = new Date().toISOString();
        setDetails((value) => {
          const detail =
            value[id] ??
            emptyDetail({
              id,
              integrationKey,
              resourceId: resourceId ?? null,
              type: "chat",
              title: NEW_THREAD_TITLE,
              settings: newSettingsRef.current[id] ?? {},
              composerDraft: "",
              createdAt: now,
              updatedAt: now,
            });
          if (detail.messages.some((message) => message.id === localMessageId)) return value;
          return {
            ...value,
            [id]: {
              ...detail,
              messages: [
                ...detail.messages,
                {
                  id: localMessageId,
                  threadId: id,
                  runId: null,
                  role: "user",
                  parts: [
                    { type: "text", text: input.message },
                    ...(input.attachmentIds ?? []).map((attachmentId) => ({
                      type: "attachment" as const,
                      attachmentId,
                    })),
                  ],
                  meta: { pending: true },
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
          };
        });
        if (clearComposer) {
          draft("", id);
          composerState({ attachmentIds: [] }, id);
        }
      }
      const creation = creating.current.get(targetScope);
      if (creation) id = (await creation).id;
      if (lockId !== id) {
        locks.current.delete(lockId);
        controllers.current.delete(lockId);
        setSubmitting((value) => ({ ...value, [lockId]: false }));
      }
      locks.current.add(id);
      controllers.current.set(id, controller);
      setSubmitting((value) => ({ ...value, [id]: true }));
      controller.signal.throwIfAborted();
      const links = options.referenceLinks ?? [];
      if (links.length > 5) throw new Error("Use at most five reference links.");
      input = {
        ...input,
        settings: {
          ...(isDraftScope(id) ? newSettingsRef.current[id] : detailsRef.current[id]?.thread.settings),
          ...input.settings,
        },
        ...(links.length ? { references: [...new Set([...(input.references ?? []), ...links])] } : {}),
      };
      // A model the provider no longer lists falls back to the admin default.
      const choice = modelChoiceRef.current;
      const pickedModel = models?.models.find((entry) => entry.id === (input.model ?? choice.model));
      if (pickedModel && pickedModel.id !== models?.defaultModel) input = { ...input, model: pickedModel.id };
      else {
        const { model: _unlisted, ...rest } = input;
        input = rest;
      }
      if (!input.effort && choice.effort) input = { ...input, effort: choice.effort };
      const previous = pending.current[id];
      const threadId = isDraftScope(id) ? (previous?.threadId ?? crypto.randomUUID()) : id;
      const { clientRequestId: _previousKey, ...previousInput } = previous ?? {};
      const sameSubmission =
        previous && JSON.stringify(previousInput) === JSON.stringify({ ...input, resourceId, threadId });
      const request = sameSubmission
        ? previous
        : { ...input, resourceId, threadId, clientRequestId: crypto.randomUUID() };
      pending.current[id] = request;
      function adoptRunThread(next: AssistantRun) {
        if (next.threadId && next.threadId !== id) {
          const previousId = id;
          adoptThread(
            {
              id: next.threadId,
              integrationKey,
              resourceId: next.resourceId,
              title: NEW_THREAD_TITLE,
              type: next.operation === "rewrite" ? "inline" : "chat",
              settings: next.request.settings ?? {},
              composerDraft: draftsRef.current[id] ?? "",
              composerState: composerStatesRef.current[id] ?? { attachmentIds: [] },
              createdAt: next.createdAt,
              updatedAt: next.updatedAt,
            },
            id,
            true,
            localMessageId,
          );
          id = next.threadId;
          locks.current.delete(previousId);
          controllers.current.delete(previousId);
          delete pending.current[previousId];
          locks.current.add(id);
          controllers.current.set(id, controller);
          setSubmitting((value) => ({ ...value, [previousId]: false, [id]: true }));
        }
      }
      const run = await streamAssistantRun(integrationKey, request, controller.signal, (event) => {
        if (!alive.current || scopeVersion.current !== scope || controller.signal.aborted) return;
        if (event.type === "run" || event.type === "completed" || (event.type === "error" && event.run)) {
          const next = event.run!;
          observedRun = next;
          adoptRunThread(next);
          if (event.type === "run" && event.attachments?.length) {
            const attachments = event.attachments;
            recoverySelection = {
              ...submittedSelection,
              attachmentIds: [...new Set([...(input.attachmentIds ?? []), ...attachments.map((file) => file.id)])],
            };
            setDetails((value) =>
              value[id]
                ? {
                    ...value,
                    [id]: {
                      ...value[id],
                      attachments: [
                        ...value[id].attachments.filter((file) => !attachments.some((item) => item.id === file.id)),
                        ...attachments,
                      ],
                    },
                  }
                : value,
            );
          }
          updateRun(next, localMessageId, streamedText);
          if (event.type === "completed" && next.status === "completed" && selectedRef.current === id)
            setFreshRunIds((value) => (value.includes(next.id) ? value : [...value, next.id]));
          if (event.type === "run") {
            delete pending.current[id];
            setStreams((value) => ({ ...value, [id]: { run: next, text: streamedText } }));
            if (
              !conversational &&
              draftsRef.current[id] === submittedDraft &&
              sameComposerSelection(composerStatesRef.current[id] ?? { attachmentIds: [] }, submittedSelection)
            ) {
              draft("", id);
              composerState({ attachmentIds: [] }, id);
            }
            onCreated?.(next);
            if (links.length) options.onReferenceAdded?.(id, []);
          }
        } else if (event.type === "reasoning-delta") {
          streamedReasoning += event.text;
          setStreams((value) =>
            value[id] ? { ...value, [id]: { ...value[id], reasoning: streamedReasoning } } : value,
          );
        } else if (event.type === "text-delta" || event.type === "text") {
          streamedText = event.type === "text" ? event.text : streamedText + event.text;
          setStreams((value) => (value[id] ? { ...value, [id]: { ...value[id], text: streamedText } } : value));
        } else if (event.type === "title") {
          const threadId = observedRun?.threadId ?? id;
          setThreads((value) =>
            value.map((thread) => (thread.id === threadId ? { ...thread, title: event.title } : thread)),
          );
          setDetails((value) =>
            value[threadId]
              ? {
                  ...value,
                  [threadId]: { ...value[threadId], thread: { ...value[threadId].thread, title: event.title } },
                }
              : value,
          );
        }
      });
      if (!alive.current || scopeVersion.current !== scope) return null;
      adoptRunThread(run);
      // A run waiting for approval has a saved outcome; the composer keeps its cleared state.
      completed = run.status === "completed" || run.status === "awaiting-approval";
      delete pending.current[id];
      updateRun(run, localMessageId, streamedText);
      if (selectedRef.current === id) setError("");
      return run;
    } catch (cause) {
      if (!alive.current || scopeVersion.current !== scope) return null;
      if (observedRun && ["queued", "running"].includes(observedRun.status))
        updateRun(
          {
            ...observedRun,
            status: "unknown",
            errorMessage: controller.signal.aborted
              ? "Request stopped. Confirming its saved status."
              : "Connection interrupted. Check the saved status before retrying.",
          },
          localMessageId,
          streamedText,
        );
      // A dropped stream is not an outcome: reload the saved run (failed, completed or still running) instead of toasting.
      if (controller.signal.aborted || (cause instanceof AssistantStreamInterruptedError && !isDraftScope(id))) {
        if (!isDraftScope(id))
          void loadThread(id).catch(() => {
            if (alive.current && scopeVersion.current === scope && selectedRef.current === id)
              setError("Could not confirm this request's saved outcome. Refresh history to check it.");
          });
        return null;
      }
      if (
        cause instanceof AssistantRequestError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        ![408, 409, 425].includes(cause.status)
      )
        delete pending.current[id];
      if (!observedRun || observedRun.executionMode !== "standalone") {
        if (resolvedScope(currentScope()) === id)
          setError(
            cause instanceof Error ? cause.message : "Could not confirm this request. Refresh history to recover it.",
          );
        toast.error(cause instanceof Error ? cause.message : "Could not send. Your message is still here.");
      }
      return null;
    } finally {
      if (alive.current && scopeVersion.current === scope) {
        let restored = false;
        if (
          clearComposer &&
          !completed &&
          !draftsRef.current[id] &&
          sameComposerSelection(composerStatesRef.current[id] ?? { attachmentIds: [] }, { attachmentIds: [] })
        ) {
          draft(submittedDraft || input.message, id);
          composerState(recoverySelection, id);
          restored = true;
        }
        setDetails((value) =>
          value[id]
            ? {
                ...value,
                [id]: {
                  ...value[id],
                  messages: value[id].messages.flatMap((message) =>
                    message.id !== localMessageId || !message.meta.pending
                      ? [message]
                      : restored || completed
                        ? []
                        : [{ ...message, meta: { failed: true } }],
                  ),
                },
              }
            : value,
        );
        locks.current.delete(lockId);
        locks.current.delete(id);
        controllers.current.delete(id);
        controllers.current.delete(lockId);
        setSubmitting((value) => ({ ...value, [lockId]: false, [id]: false }));
        setStreams((value) => {
          const next = { ...value };
          delete next[id];
          return next;
        });
      }
    }
  }
  /** Approves or rejects a paused run's tool calls; the continuation streams like a reply. */
  async function respondToApproval(run: Pick<AssistantRun, "id" | "threadId">, approved: boolean, reason?: string) {
    const id = run.threadId;
    if (!id || locks.current.has(id)) return;
    const scope = scopeVersion.current;
    const controller = new AbortController();
    const current = () => alive.current && scopeVersion.current === scope;
    locks.current.add(id);
    controllers.current.set(id, controller);
    setSubmitting((value) => ({ ...value, [id]: true }));
    let text = "";
    try {
      const next = await streamAssistantRun(
        integrationKey,
        { approved, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
        controller.signal,
        (event) => {
          if (!current() || controller.signal.aborted) return;
          if (event.type === "run") setStreams((value) => ({ ...value, [id]: { run: event.run, text } }));
          if (event.type === "run" || event.type === "completed" || (event.type === "error" && event.run))
            updateRun(event.run!, undefined, text);
          else if (event.type === "text-delta" || event.type === "text") {
            text = event.type === "text" ? event.text : text + event.text;
            setStreams((value) => (value[id] ? { ...value, [id]: { ...value[id], text } } : value));
          }
        },
        `/runs/${encodeURIComponent(run.id)}/approval`,
      );
      if (current()) updateRun(next, undefined, text);
    } catch (cause) {
      if (current() && !controller.signal.aborted && !(cause instanceof AssistantStreamInterruptedError))
        toast.error(cause instanceof Error ? cause.message : "Could not send your decision. Try again.");
    } finally {
      if (current()) {
        locks.current.delete(id);
        controllers.current.delete(id);
        setSubmitting((value) => ({ ...value, [id]: false }));
        setStreams((value) => {
          const next = { ...value };
          delete next[id];
          return next;
        });
        // The paused request now shows its recorded decision; a dropped stream shows the saved outcome.
        void loadThread(id).catch(() => {});
      }
    }
  }
  async function stop(run?: AssistantRun) {
    const id = run?.threadId ?? resolvedScope(currentScope());
    const runId = (id ? streams[id]?.run.id : undefined) ?? run?.id;
    setError("");
    // Closing the stream alone no longer stops the server run; cancel it explicitly first.
    if (runId)
      await cancelAssistantRun(integrationKey, runId).catch((cause: unknown) =>
        toast.error(cause instanceof Error ? cause.message : "Could not stop the request."),
      );
    if (id) controllers.current.get(id)?.abort();
  }
  async function remove(historyOnly: boolean) {
    const scope = scopeVersion.current;
    if (!selected) return;
    setFreshRunIds([]);
    clearing.current.add(selected);
    try {
      await settingsQueue.current[selected]?.catch(() => {});
      if (!alive.current || scopeVersion.current !== scope) return;
      await assistantRequest(`${base}/${selected}${historyOnly ? "/history" : ""}`, undefined, "DELETE");
      if (!alive.current || scopeVersion.current !== scope) return;
      threadLoads.current[selected] = (threadLoads.current[selected] ?? 0) + 1;
      delete pending.current[selected];
      draft("", selected);
      composerState({ attachmentIds: [] }, selected);
      setDetails((value) => {
        const next = { ...value };
        delete next[selected];
        return next;
      });
      if (historyOnly) await loadThread(selected);
      else {
        remember(null);
        await refresh();
      }
    } finally {
      if (scopeVersion.current === scope) clearing.current.delete(selected);
    }
  }
  async function upload(file: File, targetScope = currentScope()) {
    const scope = scopeVersion.current;
    const id = (await createThread(true, undefined, targetScope)).id;
    const body = new FormData();
    body.set("file", file);
    const result = await assistantRequest<{ attachment: AssistantAttachment }>(`${base}/${id}/attachments`, body);
    if (!alive.current || scopeVersion.current !== scope)
      throw new DOMException("Assistant context changed.", "AbortError");
    setDetails((value) =>
      value[id]
        ? { ...value, [id]: { ...value[id], attachments: [...value[id].attachments, result.attachment] } }
        : value,
    );
    return result.attachment;
  }
  async function addLink(url: string, targetScope = currentScope()) {
    const scope = scopeVersion.current;
    const id = (await createThread(true, undefined, targetScope)).id;
    const { attachment } = await assistantRequest<{ attachment: AssistantAttachment }>(`${base}/${id}/attachments`, {
      type: "link",
      label: url,
      url,
    });
    if (!alive.current || scopeVersion.current !== scope)
      throw new DOMException("Assistant context changed.", "AbortError");
    setDetails((value) =>
      value[id] ? { ...value, [id]: { ...value[id], attachments: [...value[id].attachments, attachment] } } : value,
    );
    return attachment;
  }
  async function removeAttachment(attachment: AssistantAttachment) {
    const scope = scopeVersion.current;
    await assistantRequest(`${base}/${attachment.threadId}/attachments/${attachment.id}`, undefined, "DELETE");
    if (!alive.current || scopeVersion.current !== scope) return;
    setDetails((value) =>
      value[attachment.threadId]
        ? {
            ...value,
            [attachment.threadId]: {
              ...value[attachment.threadId],
              attachments: value[attachment.threadId].attachments.filter((entry) => entry.id !== attachment.id),
            },
          }
        : value,
    );
  }
  return {
    apiBase,
    threads,
    freshRunIds,
    activeThreadIds: Object.keys(submitting).filter((id) => submitting[id]),
    scopeId: selected ?? draftScope,
    resolveScopeId: resolvedScope,
    selected,
    detail: details[selected ?? draftScope],
    message: drafts[selected ?? draftScope] ?? "",
    availability,
    models,
    modelChoice,
    setModelChoice,
    loading,
    historyStatus,
    error,
    submitting: submitting[selected ?? draftScope] || false,
    draft,
    getDraft: (id = currentScope()) => draftsRef.current[resolvedScope(id)] ?? draftsRef.current[id] ?? "",
    refresh,
    choose,
    startNewThread,
    createThread,
    composerSelection: composerStates[selected ?? draftScope] ?? { attachmentIds: [] },
    composerState,
    rememberAttachment: (file: AssistantAttachment) =>
      setDetails((value) =>
        value[file.threadId]
          ? {
              ...value,
              [file.threadId]: {
                ...value[file.threadId],
                attachments: [...value[file.threadId].attachments.filter((old) => old.id !== file.id), file],
              },
            }
          : value,
      ),
    getComposerSelection: (id = currentScope()) =>
      composerStatesRef.current[resolvedScope(id)] ?? composerStatesRef.current[id] ?? { attachmentIds: [] },
    composerSelectionsByThread: composerStates,
    loadExecutions,
    requestSettings: selected ? (details[selected]?.thread.settings ?? {}) : (newSettings[draftScope] ?? {}),
    settings,
    saveDraft,
    selectVariant,
    send,
    respondToApproval,
    stop,
    remove,
    upload,
    addLink,
    stream: selected ? streams[selected] : undefined,
    removeAttachment,
    updateRun,
  };
}
