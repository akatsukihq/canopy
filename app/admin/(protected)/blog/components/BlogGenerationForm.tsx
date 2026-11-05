"use client";

import { appHref } from "@/lib/routing/subdomains.ts";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button, H1, Input, Label, Select, Textarea, toast } from "@/components/ui/index.tsx";
import type { AssistantAvailability, AssistantRun, AssistantRunRequest } from "@/lib/assistant/types";
import {
  activeRun,
  AssistantRequestError,
  assistantRequest,
  cancelAssistantRun,
  streamAssistantRun,
} from "@/lib/assistant/client";

import { BlogGenerationProgress } from "./BlogGenerationProgress";

type Brief = {
  idea: string;
  language: string;
  tone: string;
  length: string;
  keyword: string;
  audience: string;
  references: string;
};
const EMPTY: Brief = {
  idea: "",
  language: "English",
  tone: "From your idea",
  length: "Auto · 1,000–1,500 words",
  keyword: "",
  audience: "",
  references: "",
};
function restoreBrief(value: unknown): Brief {
  if (!value || typeof value !== "object") return { ...EMPTY };
  const saved = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(EMPTY).map(([key, fallback]) => [key, typeof saved[key] === "string" ? saved[key] : fallback]),
  ) as Brief;
}

function briefFromRequest(request: AssistantRunRequest): Brief {
  return restoreBrief({ ...request.settings, idea: request.message, references: request.references?.join("\n") ?? "" });
}

function restoreRequest(value: unknown): AssistantRunRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (
    request.schemaVersion !== 1 ||
    request.operation !== "generate" ||
    typeof request.clientRequestId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(request.clientRequestId) ||
    typeof request.message !== "string" ||
    !request.message.trim()
  )
    return null;
  if (
    request.settings !== undefined &&
    (!request.settings || typeof request.settings !== "object" || Array.isArray(request.settings))
  )
    return null;
  if (
    request.references !== undefined &&
    (!Array.isArray(request.references) || request.references.some((value) => typeof value !== "string"))
  )
    return null;
  if (
    Object.keys(request).some(
      (key) =>
        ![
          "schemaVersion",
          "operation",
          "clientRequestId",
          "message",
          "settings",
          "references",
          "resourceId",
          "threadId",
          "inputMessageId",
        ].includes(key),
    )
  )
    return null;
  if (
    request.settings &&
    Object.entries(request.settings).some(([key, value]) =>
      key === "webSearch"
        ? typeof value !== "boolean"
        : !["language", "tone", "length", "keyword", "audience"].includes(key) || typeof value !== "string",
    )
  )
    return null;
  // Keep the exact submitted snapshot: normalization changes its idempotency hash.
  return request as AssistantRunRequest;
}

export function BlogGenerationForm({
  hidden,
  userId,
  onState,
}: {
  hidden: boolean;
  userId: string;
  onState: (state: { busy: boolean; enabled: boolean; status: string; formVisible: boolean }) => void;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState(EMPTY);
  const [customize, setCustomize] = useState(false);
  const [availability, setAvailability] = useState<AssistantAvailability | null>(null);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [availabilityError, setAvailabilityError] = useState("");
  const [run, setRun] = useState<AssistantRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoringRequest = useRef(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  /** Live agent steps and their streamed reasoning for this tab's generation. */
  const [steps, setSteps] = useState<{ label: string; reasoning: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const submission = useRef<AssistantRunRequest | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const dismissed = useRef(false);
  const navigated = useRef<string | null>(null);
  const storagePrefix = `assistant-generation:blog:${userId}:v1:`;
  const busy = submitting || restoring || recovering || (!!run && activeRun(run.status));
  const status = restoring
    ? "Restoring your generation…"
    : recovering
      ? "Submission status unknown · Retry to check the same request"
      : run?.status === "unknown"
        ? "Checking request status — do not submit again"
        : run?.status === "running"
          ? "Generating and validating your draft…"
          : run?.status === "queued"
            ? "Queued for generation…"
            : run?.status === "completed"
              ? "Draft created"
              : run?.status === "failed"
                ? "Generation failed · Your idea is preserved"
                : run?.status === "cancelled"
                  ? "Cancelled · Your idea is preserved"
                  : submitting
                    ? "Starting generation…"
                    : "Idea · Not saved yet";
  useEffect(() => {
    onState({ busy, enabled: !!availability?.enabled && loaded, status, formVisible: !run && !submitting });
  }, [busy, availability?.enabled, loaded, status, onState, run, submitting]);

  function clearSubmission() {
    submission.current = null;
    setRecovering(false);
    try {
      sessionStorage.removeItem(`${storagePrefix}request`);
    } catch {
      /* Recovery still works in memory. */
    }
  }

  function receiveRun(next: AssistantRun) {
    if (next.operation !== "generate")
      throw new Error("This request is not a blog generation. Start a new idea or return to your post.");
    clearSubmission();
    setRun(next);
    setBrief(briefFromRequest(next.request));
    setConnectionError("");
  }

  async function restoreRun(id: string) {
    if (restoringRequest.current) return;
    restoringRequest.current = true;
    setRestoring(true);
    try {
      const result = await assistantRequest<{ run: AssistantRun }>(
        `/api/assistant/blog/runs/${encodeURIComponent(id)}`,
      );
      if (alive.current) receiveRun(result.run);
    } catch (cause) {
      if (alive.current) {
        setConnectionError(cause instanceof Error ? cause.message : "Could not restore this generation.");
        if (cause instanceof AssistantRequestError && [400, 403, 404].includes(cause.status)) {
          setResumeId(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("run");
          window.history.replaceState(null, "", url);
        }
      }
    } finally {
      restoringRequest.current = false;
      if (alive.current) setRestoring(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    try {
      // Retire old Blog wire-format submissions; only shared Assistant requests are recoverable.
      sessionStorage.removeItem("blog-generation-brief");
      sessionStorage.removeItem("blog-generation-request");
      sessionStorage.removeItem(`blog-generation:${userId}:brief`);
      sessionStorage.removeItem(`blog-generation:${userId}:request`);
      setBrief(restoreBrief(JSON.parse(sessionStorage.getItem(`${storagePrefix}brief`) ?? "null")));
      submission.current = restoreRequest(JSON.parse(sessionStorage.getItem(`${storagePrefix}request`) ?? "null"));
      if (!submission.current) sessionStorage.removeItem(`${storagePrefix}request`);
      if (submission.current) {
        setBrief(briefFromRequest(submission.current));
        setRecovering(true);
        setConnectionError("An earlier submission needs a status check. Retry checks that same request.");
      }
    } catch {
      /* Browser recovery is optional; form still works in memory. */
    }
    setLoaded(true);
    const id = new URLSearchParams(window.location.search).get("run");
    if (id) {
      setResumeId(id);
      void restoreRun(id);
    }
    const abort = () => controller.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      alive.current = false;
      controller.current?.abort();
      window.removeEventListener("pagehide", abort);
    };
    // The parent keys this component by authenticated user; recovery belongs to that mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let stopped = false;
    setAvailabilityError("");
    void assistantRequest<AssistantAvailability>("/api/assistant/blog/config")
      .then((value) => {
        if (!stopped) setAvailability(value);
      })
      .catch((cause) => {
        if (!stopped) setAvailabilityError(cause instanceof Error ? cause.message : "Could not load AI availability.");
      });
    return () => {
      stopped = true;
    };
  }, [availabilityAttempt]);
  useEffect(() => {
    if (loaded)
      try {
        sessionStorage.setItem(`${storagePrefix}brief`, JSON.stringify(brief));
      } catch {
        /* Preserve in-memory brief. */
      }
  }, [brief, loaded, storagePrefix]);
  useEffect(() => {
    if (dismissed.current || run?.status !== "completed" || !run.resourceId || navigated.current === run.resourceId)
      return;
    navigated.current = run.resourceId;
    clearSubmission();
    router.push(
      appHref(
        `/admin/blog/${encodeURIComponent(run.resourceId)}?review=1${run.threadId ? `&thread=${encodeURIComponent(run.threadId)}` : ""}`,
      ),
    );
  }, [run, router]);

  function change(key: keyof Brief, value: string) {
    setBrief((state) => ({ ...state, [key]: value }));
    if (key === "references") setReferenceError("");
    else setFieldError("");
  }
  async function generate() {
    if (
      lock.current ||
      submitting ||
      restoring ||
      (!!run && activeRun(run.status)) ||
      !availability?.enabled ||
      !loaded
    )
      return;
    const references = brief.references
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!submission.current) {
      if (!brief.idea.trim() || brief.idea.length > 8000) {
        setFieldError("Describe your idea in 1–8,000 characters.");
        return;
      }
      if (references.length > 5) {
        setReferenceError("Use at most five reference links.");
        setCustomize(true);
        return;
      }
      setRun(null);
      setResumeId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("run");
      window.history.replaceState(null, "", url);
    }
    lock.current = true;
    dismissed.current = false;
    const abort = new AbortController();
    controller.current = abort;
    setSubmitting(true);
    setConnectionError("");
    setSteps([]);
    const request = submission.current ?? {
      schemaVersion: 1,
      operation: "generate",
      effort: "high",
      clientRequestId: crypto.randomUUID(),
      message: brief.idea.trim(),
      settings: {
        language: brief.language,
        tone: brief.tone,
        length: brief.length,
        keyword: brief.keyword,
        audience: brief.audience,
        webSearch: false,
      },
      references,
      ...(run?.resourceId
        ? {
            resourceId: run.resourceId,
            threadId: run.threadId ?? undefined,
            inputMessageId: run.inputMessageId ?? undefined,
          }
        : {}),
    };
    submission.current = request;
    try {
      sessionStorage.setItem(`${storagePrefix}request`, JSON.stringify(request));
    } catch {
      /* Retry remains deduplicated in memory. */
    }
    try {
      await streamAssistantRun("blog", request, abort.signal, (event) => {
        if (!alive.current || abort.signal.aborted) return;
        if (event.type === "step") setSteps((value) => [...value, { label: event.label, reasoning: "" }]);
        else if (event.type === "reasoning-delta")
          setSteps((value) =>
            value.length
              ? [...value.slice(0, -1), { ...value.at(-1)!, reasoning: value.at(-1)!.reasoning + event.text }]
              : [{ label: "Thinking", reasoning: event.text }],
          );
        if (event.type === "run" || event.type === "completed" || (event.type === "error" && event.run)) {
          const next = event.run!;
          receiveRun(next);
          setResumeId(next.id);
          const url = new URL(window.location.href);
          url.searchParams.set("run", next.id);
          window.history.replaceState(null, "", url);
        }
      });
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (alive.current) {
        const message =
          cause instanceof Error ? cause.message : "Could not start generation. Retry to check the same request.";
        const rejected =
          cause instanceof AssistantRequestError &&
          cause.status >= 400 &&
          cause.status < 500 &&
          ![408, 409, 425].includes(cause.status);
        if (rejected) {
          clearSubmission();
          if (cause.status === 400 || cause.status === 422) {
            if (/reference|https|link/i.test(message)) {
              setReferenceError(message);
              setCustomize(true);
            } else setFieldError(message);
          } else {
            setConnectionError(message);
            toast.error(message);
          }
        } else {
          setRecovering(!!submission.current);
          setConnectionError(message);
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setSubmitting(false);
    }
  }
  async function cancel() {
    dismissed.current = true;
    const runId = run?.id;
    try {
      if (runId) await cancelAssistantRun("blog", runId);
      setConnectionError("Generation stopped. Your idea is saved; try again when ready.");
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : "Could not stop generation. Refresh status to check its outcome.",
      );
    }
    controller.current?.abort();
  }
  if (!hidden && (run || submitting))
    return (
      <BlogGenerationProgress
        run={run}
        brief={brief.idea}
        steps={steps}
        streaming={submitting && !controller.current?.signal.aborted}
        refreshing={restoring}
        error={connectionError || run?.errorMessage || undefined}
        onCancel={() => void cancel()}
        onRetry={() => void generate()}
        onRefresh={run ? () => void restoreRun(run.id) : undefined}
        onEdit={
          run?.resourceId
            ? () => router.push(appHref(`/admin/blog/${encodeURIComponent(run.resourceId!)}?edit=1`))
            : undefined
        }
      />
    );
  return (
    <form
      id="blog-generation"
      hidden={hidden}
      aria-labelledby="blog-ai-heading"
      noValidate
      aria-busy={busy}
      className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 max-md:[&_button]:min-h-11"
      onSubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
    >
      <H1 id="blog-ai-heading">Your idea. A complete blog.</H1>
      <p className="mt-3 text-body-large text-muted-foreground">
        Create an editable article with keywords and SEO metadata.
      </p>
      <p id="blog-ai-unavailable" className="mt-3 text-caption text-muted-foreground">
        {availability?.enabled
          ? `Your brief and reference links are sent to ${availability.provider}. Nothing is published automatically.`
          : availabilityError || availability?.reason || "Checking AI availability…"}
      </p>
      {(availabilityError || (availability && !availability.enabled)) && (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => setAvailabilityAttempt((value) => value + 1)}
        >
          Check availability
        </Button>
      )}
      <fieldset disabled={busy} className="min-w-0">
        <div className="mt-6 space-y-2">
          <Label htmlFor="blog-ai-idea">What would you like to write about?</Label>
          <Textarea
            id="blog-ai-idea"
            name="idea"
            value={brief.idea}
            onChange={(event) => change("idea", event.target.value)}
            rows={5}
            required
            maxLength={8000}
            aria-invalid={!!fieldError}
            aria-describedby="blog-ai-idea-help"
            className="min-h-28 resize-y md:min-h-36"
            placeholder="Describe your topic, who it is for, and the points you want to cover…"
          />
          <p
            id="blog-ai-idea-help"
            aria-live="polite"
            className={`text-caption ${fieldError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {fieldError || `${brief.idea.length}/8,000 characters`}
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              name: "language" as const,
              label: "Language",
              options: ["English", "Hindi", "Spanish", "French", "German"],
            },
            {
              name: "tone" as const,
              label: "Tone",
              options: ["From your idea", "Professional", "Conversational", "Educational"],
            },
            {
              name: "length" as const,
              label: "Target length",
              options: ["Auto · 1,000–1,500 words", "Short · 500–800 words", "Long · 1,500–2,000 words"],
            },
          ].map(({ name, label, options }) => (
            <div key={name} className="min-w-0 space-y-2">
              <Label htmlFor={`blog-ai-${name}`}>{label}</Label>
              <Select
                id={`blog-ai-${name}`}
                name={name}
                value={brief[name]}
                onChange={(event) => change(name, event.target.value)}
              >
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-caption text-muted-foreground">Add a target keyword, audience, or references.</p>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={customize}
            aria-controls="blog-ai-customize"
            onClick={() => setCustomize(!customize)}
          >
            Customize
            <ChevronDown className={customize ? "rotate-180" : undefined} aria-hidden="true" />
          </Button>
        </div>
        <div id="blog-ai-customize" hidden={!customize} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="blog-ai-keyword">Target keyword (optional)</Label>
              <Input
                id="blog-ai-keyword"
                maxLength={200}
                value={brief.keyword}
                onChange={(event) => change("keyword", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="blog-ai-audience">Audience (optional)</Label>
              <Input
                id="blog-ai-audience"
                maxLength={300}
                value={brief.audience}
                onChange={(event) => change("audience", event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="blog-ai-references">Reference links (optional)</Label>
            <Textarea
              id="blog-ai-references"
              aria-invalid={!!referenceError}
              aria-describedby="blog-ai-reference-help"
              value={brief.references}
              onChange={(event) => change("references", event.target.value)}
              rows={2}
              placeholder="https://example.com/article"
            />
            <p
              id="blog-ai-reference-help"
              aria-live="polite"
              className={`text-caption ${referenceError ? "text-destructive" : "text-muted-foreground"}`}
            >
              {referenceError ||
                "Up to five public HTTPS links, one per line. Web access is off; these references have not been read."}
            </p>
          </div>
        </div>
      </fieldset>
      {connectionError && (
        <div className="mt-4 space-y-2">
          <p role="alert" className="text-caption text-destructive">
            {connectionError}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={submitting || restoring}
            onClick={() => {
              if (!availability?.enabled) setAvailabilityAttempt((value) => value + 1);
              else if (recovering) void generate();
              else if (run || resumeId) void restoreRun(run?.id ?? resumeId!);
              else void generate();
            }}
          >
            {recovering ? "Check submission" : "Retry connection"}
          </Button>
        </div>
      )}
      {run?.errorMessage && (
        <p role="alert" className="mt-4 text-caption text-destructive">
          {run.errorMessage}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button type="submit" className="hidden md:inline-flex" disabled={!availability?.enabled || busy || !loaded}>
          <Sparkles aria-hidden="true" />
          {run && !activeRun(run.status) ? "Generate a new draft" : "Generate blog"}
        </Button>
        {run && activeRun(run.status) && (
          <Button variant="outline" disabled={!submitting} onClick={() => void cancel()}>
            Cancel generation
          </Button>
        )}
        <p role="status" className="text-caption text-muted-foreground">
          {status}
        </p>
      </div>
      <p className="mt-3 text-caption text-muted-foreground">
        Your brief is preserved in this browser tab. Retrying generation reuses its saved draft.
      </p>
    </form>
  );
}
