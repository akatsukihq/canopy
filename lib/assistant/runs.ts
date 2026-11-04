/** Integration-scoped persistence and request-bound provider streaming. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  and,
  db,
  desc,
  eq,
  inArray,
  sql,
  assistantThreadsTable as threads,
  assistantRunsTable as runs,
  assistantMessagesTable as messages,
  assistantAttachmentsTable as attachments,
} from "../../db/index.ts";
import { AIClient } from "../ai/client.ts";
import { AIError } from "../ai/errors.ts";
import type { AIResult, AIToolCall } from "../ai/types.ts";
import config from "../config/config.ts";
import { loadRuntimeSettings } from "../config/runtimeSettings.ts";
import { ACTIVE_RUN_STATUSES, privateExpiry, type AssistantThreads } from "./threads.ts";
import {
  AssistantError,
  assistantId,
  validateRunRequest,
  emptyAssistantResult,
  parseStoredRequest,
  parseStoredResult,
  parseMessageParts,
} from "./validation.ts";
import type { AssistantIntegration, AssistantTransaction, StoredRun, AuxiliaryResult } from "./integration.ts";
import type { AssistantMessagePart, AssistantProposal, AssistantRunRequest, AssistantEvent } from "./types.ts";

export function createAssistantRuns(integration: AssistantIntegration, storage: AssistantThreads) {
  const { requireThread, requireAssistantClient, attachmentsForRun, attachmentView, runView, messageView } = storage;
  const active = (run: StoredRun) => ACTIVE_RUN_STATUSES.some((status) => status === run.status);
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const handlesOf = (run: StoredRun): string[] =>
    Array.isArray(run.continuation.handles)
      ? run.continuation.handles.filter((id): id is string => typeof id === "string")
      : [];

  async function authorizeRun(tx: AssistantTransaction, actor: string, id: string, edit = false) {
    assistantId.parse(id);
    const [candidate] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, id),
          eq(runs.ownerId, actor),
          eq(runs.integrationKey, integration.key),
          sql`${runs.expiresAt} > now()`,
        ),
      );
    if (!candidate) throw new AssistantError("NOT_FOUND", "This private request is no longer available.", 404);
    if (candidate.threadId)
      await requireThread(tx, actor, candidate.resourceId, candidate.threadId, {
        edit,
        operation: candidate.operation,
        forUpdate: true,
      });
    else await integration.authorize(tx, actor, candidate.resourceId, edit, candidate.operation);
    const [run] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, id),
          eq(runs.ownerId, actor),
          eq(runs.integrationKey, integration.key),
          sql`${runs.expiresAt} > now()`,
        ),
      )
      .for("update");
    if (!run || run.continuation.cleared === true)
      throw new AssistantError("NOT_FOUND", "This private request is no longer available.", 404);
    return {
      ...run,
      request: parseStoredRequest(run.request),
      response: parseStoredResult(run.response),
    };
  }

  /** Reserve records once. No provider work or active-thread gate inside the transaction. */
  async function startRun(actor: string, input: unknown) {
    let request = validateRunRequest(input);
    const submissionHash = digest(request);
    const caps = (await requireAssistantClient()).getCapabilities();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor, integration.key, request.clientRequestId])},0))`,
      );
      const [existing] = await tx
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.ownerId, actor),
            eq(runs.integrationKey, integration.key),
            eq(runs.clientRequestId, request.clientRequestId),
          ),
        );
      if (existing) {
        const authorized = await authorizeRun(tx, actor, existing.id);
        if (existing.continuation.submissionHash !== submissionHash)
          throw new AssistantError("CONFLICT", "This request ID was used for different content.", 409);
        const inputIds = authorized.request.attachmentIds ?? [];
        const referenceAttachments =
          request.references?.length && inputIds.length
            ? await tx
                .select()
                .from(attachments)
                .where(
                  and(
                    inArray(attachments.id, inputIds),
                    eq(attachments.ownerId, actor),
                    eq(attachments.threadId, authorized.threadId!),
                  ),
                )
            : [];
        return { run: authorized, fresh: false, attachments: referenceAttachments.map((file) => attachmentView(file)) };
      }
      const [thread] = request.threadId
        ? await tx
            .select()
            .from(threads)
            .where(
              and(
                eq(threads.id, request.threadId),
                eq(threads.ownerId, actor),
                eq(threads.integrationKey, integration.key),
                request.resourceId === undefined ? undefined : eq(threads.resourceId, request.resourceId),
                sql`${threads.updatedAt} > now() - interval '30 days'`,
              ),
            )
            .for("update")
        : [];
      if (request.inputMessageId && !thread)
        throw new AssistantError("NOT_FOUND", "The original message is not in this thread.", 404);
      if (thread) request = { ...request, resourceId: thread.resourceId ?? undefined };
      request = integration.validateRequest(request);
      const operation = integration.operation(request);
      if (operation.structuredOutput && !caps.structuredOutput)
        throw new AssistantError("CAPABILITY", "This provider cannot produce structured results.");
      await integration.authorize(tx, actor, request.resourceId ?? null, true, request.operation);
      const resourceId = (await integration.reserveResource?.(tx, actor, request)) ?? request.resourceId ?? null;
      if (resourceId !== (request.resourceId ?? null))
        await integration.authorize(tx, actor, resourceId, true, request.operation);
      const existingThread = thread?.resourceId === resourceId ? thread : undefined;
      const threadId = existingThread?.id ?? randomUUID();
      let settings = request.settings ?? {};
      const messageTitle = request.message.replace(/\s+/g, " ").slice(0, 80);
      let titleFromFirstMessage = false;
      if (existingThread) {
        const { composerDraft: _, composerState: __, ...saved } = existingThread.settings;
        settings = { ...integration.validateSettings(saved), ...settings };
        if (!request.inputMessageId) {
          const [firstMessage] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.threadId, threadId), eq(messages.role, "user")))
            .limit(1);
          const [firstRun] = firstMessage
            ? []
            : await tx.select({ id: runs.id }).from(runs).where(eq(runs.threadId, threadId)).limit(1);
          titleFromFirstMessage = !firstMessage && !firstRun;
        }
      } else {
        settings = { ...integration.defaultSettings, ...integration.validateSettings(settings) };
        await tx.insert(threads).values({
          id: threadId,
          resourceId,
          integrationKey: integration.key,
          ownerId: actor,
          type: operation.threadType,
          title: messageTitle,
          settings,
        });
      }
      if (settings.webSearch && !caps.webSearch)
        throw new AssistantError("CAPABILITY", "The selected provider does not support source searches.");
      let effective: AssistantRunRequest = {
        ...request,
        schemaVersion: 1,
        resourceId: resourceId ?? undefined,
        threadId,
        settings,
      };
      let inputMessageId = request.inputMessageId;
      if (inputMessageId) {
        const [original] = await tx
          .select()
          .from(messages)
          .where(and(eq(messages.id, inputMessageId), eq(messages.threadId, threadId), eq(messages.role, "user")));
        const [originalRun] = await tx
          .select()
          .from(runs)
          .where(and(eq(runs.inputMessageId, inputMessageId), eq(runs.threadId, threadId), eq(runs.ownerId, actor)))
          .orderBy(desc(runs.createdAt))
          .limit(1);
        if (!original || !originalRun || originalRun.operation !== request.operation)
          throw new AssistantError("NOT_FOUND", "The original message is not in this thread.", 404);
        effective = integration.retryRequest(parseStoredRequest(originalRun.request), { ...request, settings });
        effective = integration.validateRequest({
          ...effective,
          schemaVersion: 1,
          resourceId: resourceId ?? undefined,
          threadId,
        });
      }
      const selected = await attachmentsForRun(
        tx,
        actor,
        threadId,
        config.ai.provider,
        effective.attachmentIds ?? [],
        inputMessageId,
        operation.executionMode === "standalone",
      );
      const referenceAttachments = effective.references?.length
        ? await tx
            .insert(attachments)
            .values(
              effective.references.map((url) => ({
                id: randomUUID(),
                threadId,
                ownerId: actor,
                type: "link",
                label: new URL(url).hostname,
                data: { url },
                status: "ready" as const,
              })),
            )
            .returning()
        : [];
      if (referenceAttachments.length)
        effective = {
          ...effective,
          attachmentIds: [...(effective.attachmentIds ?? []), ...referenceAttachments.map((file) => file.id)],
          references: [],
        };
      selected.push(...referenceAttachments);
      if (selected.some((file) => file.type === "file") && !caps.images)
        throw new AssistantError("CAPABILITY", "The selected provider cannot read images.");
      if (operation.executionMode === "standalone" || selected.some((file) => file.type === "artifact")) {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ request: effective, inputs: selected.map((file) => file.data) }),
        ).length;
        if (bytes > 1024 * 1024)
          throw new AssistantError(
            "VALIDATION",
            "The combined context and attachments exceed 1 MiB. Remove an input or shorten the context.",
          );
      }
      if (!inputMessageId && operation.executionMode === "conversational") {
        inputMessageId = randomUUID();
        const parts: AssistantMessagePart[] = [
          { type: "text", text: request.message },
          ...selected.map((file) => ({ type: "attachment" as const, attachmentId: file.id })),
        ];
        await tx.insert(messages).values({ id: inputMessageId, threadId, role: "user", parts, meta: {} });
        const boundInputs = selected.filter((file) => file.type !== "artifact");
        if (boundInputs.length)
          await tx
            .update(attachments)
            .set({ messageId: inputMessageId, updatedAt: new Date() })
            .where(
              inArray(
                attachments.id,
                boundInputs.map((file) => file.id),
              ),
            );
      }
      const assistantMessageId = operation.executionMode === "standalone" ? null : randomUUID();
      const [run] = await tx
        .insert(runs)
        .values({
          id: randomUUID(),
          threadId,
          resourceId,
          integrationKey: integration.key,
          ownerId: actor,
          inputMessageId,
          clientRequestId: request.clientRequestId,
          operation: request.operation,
          executionMode: operation.executionMode,
          provider: config.ai.provider,
          model: caps.model,
          status: "queued",
          request: effective,
          expiresAt: privateExpiry(),
          continuation: { submissionHash, assistantMessageId, handles: [] },
        })
        .returning();
      if (assistantMessageId)
        await tx
          .insert(messages)
          .values({ id: assistantMessageId, threadId, runId: run.id, role: "assistant", parts: [], meta: {} });
      await tx
        .update(threads)
        .set({
          ...(titleFromFirstMessage ? { title: messageTitle } : {}),
          updatedAt: new Date(),
        })
        .where(eq(threads.id, threadId));
      return {
        run,
        fresh: true,
        attachments: referenceAttachments.map((file) => attachmentView({ ...file, messageId: inputMessageId ?? null })),
      };
    });
  }

  async function executionContext(run: StoredRun) {
    return db.transaction(async (tx) => {
      await authorizeRun(tx, run.ownerId, run.id, true);
      const definition = integration.operation(run.request);
      const history =
        run.threadId && definition.includeHistory
          ? await tx
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.threadId, run.threadId),
                  sql`${messages.id} <> ${run.inputMessageId}`,
                  sql`(${messages.runId} IS NULL OR (${messages.runId} <> ${run.id} AND EXISTS (SELECT 1 FROM assistant_runs complete WHERE complete.id = ${messages.runId} AND complete.status = 'completed' AND complete.expires_at > now())))`,
                  sql`NOT EXISTS (SELECT 1 FROM assistant_runs excluded WHERE excluded.thread_id = ${run.threadId} AND excluded.execution_mode = 'standalone' AND (excluded.id = ${messages.runId} OR excluded.input_message_id = ${messages.id}))`,
                  sql`NOT EXISTS (SELECT 1 FROM assistant_runs expired WHERE expired.thread_id = ${run.threadId} AND expired.input_message_id = ${messages.id} AND expired.expires_at <= now() AND NOT EXISTS (SELECT 1 FROM assistant_runs fresh WHERE fresh.input_message_id = expired.input_message_id AND fresh.expires_at > now()))`,
                ),
              )
              .orderBy(desc(messages.updatedAt))
              .limit(24)
          : [];
      const files = run.threadId
        ? await attachmentsForRun(
            tx,
            run.ownerId,
            run.threadId,
            run.provider,
            run.request.attachmentIds ?? [],
            run.inputMessageId ?? undefined,
            run.executionMode === "standalone",
          )
        : [];
      return { history: history.reverse().map(messageView), attachments: files };
    });
  }

  function resultParts(
    response: ReturnType<typeof emptyAssistantResult>,
    calls: AIToolCall[] = [],
  ): AssistantMessagePart[] {
    return [
      ...(response.text ? [{ type: "text" as const, text: response.text }] : []),
      ...calls.flatMap((call): AssistantMessagePart[] => [
        { type: "tool-call", id: call.id, name: call.name, input: call.input },
        { type: "tool-result", id: call.id, name: call.name, output: call.output ?? { status: "pending_review" } },
      ]),
      ...response.proposals.map((proposal) => ({ type: "proposal" as const, proposal })),
    ];
  }

  function combinedUsage(...values: Array<AIResult["usage"]>): AIResult["usage"] {
    if (!values.some(Boolean)) return undefined;
    const usage: NonNullable<AIResult["usage"]> = {};
    for (const value of values)
      for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const)
        if (value?.[key] !== undefined) usage[key] = (usage[key] ?? 0) + value[key];
    return usage;
  }

  async function finishRun(
    id: string,
    result: AIResult,
    proposals: AssistantProposal[],
    auxiliaryResult?: AuxiliaryResult,
  ) {
    return db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(runs).where(eq(runs.id, id));
      if (!candidate) throw new AssistantError("NOT_FOUND", "Request no longer exists.", 404);
      const run = await authorizeRun(tx, candidate.ownerId, id, true);
      if (run.status === "completed") return run;
      if (!active(run))
        throw new AssistantError("CONFLICT", "This request has already stopped. Run the agent again.", 409);
      const selected = run.threadId
        ? await attachmentsForRun(
            tx,
            run.ownerId,
            run.threadId,
            run.provider,
            run.request.attachmentIds ?? [],
            run.inputMessageId ?? undefined,
            run.executionMode === "standalone",
          )
        : [];
      const validated = integration.validateResult(
        result,
        run.request,
        proposals,
        selected.filter((file) => file.type === "artifact").map((file) => file.id),
      );
      if (validated.artifact) {
        if (!run.threadId || !integration.isArtifact(validated.artifact.value))
          throw new AssistantError("INVALID_OUTPUT", "The result is not a supported artifact.", 422);
        const attachmentId = randomUUID();
        await tx.insert(attachments).values({
          id: attachmentId,
          threadId: run.threadId,
          ownerId: run.ownerId,
          runId: run.id,
          messageId: null,
          type: "artifact",
          label: validated.artifact.label,
          data: { artifact: validated.artifact.value },
          status: "ready",
          expiresAt: run.expiresAt,
        });
        validated.response.artifact = {
          ...validated.artifact.reference,
          attachmentId,
          label: validated.artifact.label,
          agentId: validated.artifact.value.agentId,
          summary: validated.artifact.value.summary,
        };
      }
      await integration.complete?.(tx, run, validated);
      const usage = combinedUsage(result.usage, auxiliaryResult?.usage);
      const handles = [
        ...new Set(
          [...handlesOf(run), result.id, ...(auxiliaryResult?.id ? [auxiliaryResult.id] : [])].filter(Boolean),
        ),
      ];
      const now = new Date();
      const [updated] = await tx
        .update(runs)
        .set({
          status: "completed",
          model: result.model,
          providerResponseId: result.id || null,
          response: validated.response,
          usage: usage ?? null,
          continuation: { ...run.continuation, handles },
          completedAt: now,
          updatedAt: now,
          errorMessage: null,
        })
        .where(eq(runs.id, id))
        .returning();
      await tx
        .update(messages)
        .set({
          parts: resultParts(validated.response, result.toolCalls),
          meta: {
            ...(usage ? { usage } : {}),
            provider: {
              name: result.provider,
              model: result.model,
              responseId: result.id,
              details: {
                ...result.details,
                metadata: result.metadata,
                ...(auxiliaryResult
                  ? {
                      auxiliary: {
                        model: auxiliaryResult.model,
                        responseId: auxiliaryResult.id,
                        usage: auxiliaryResult.usage,
                      },
                    }
                  : {}),
              },
            },
          },
          updatedAt: now,
        })
        .where(eq(messages.runId, id));
      if (run.threadId) await tx.update(threads).set({ updatedAt: now }).where(eq(threads.id, run.threadId));
      return updated;
    });
  }

  /** NDJSON keeps SDK/provider details behind the shared AI client. */
  async function streamRun(actor: string, input: unknown, requestSignal: AbortSignal): Promise<Response> {
    const { run, fresh, attachments: inputAttachments } = await startRun(actor, input);
    const abort = new AbortController();
    let providerComplete = false;
    const onAbort = () => {
      if (!providerComplete) abort.abort();
    };
    requestSignal.addEventListener("abort", onAbort, { once: true });
    if (requestSignal.aborted) onAbort();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (event: AssistantEvent) => {
          if (closed || requestSignal.aborted) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            closed = true;
          }
        };
        let auxiliaryWork: Promise<AuxiliaryResult | undefined> | undefined;
        const auxiliaryAbort = new AbortController();
        const cancelAuxiliary = () => auxiliaryAbort.abort();
        abort.signal.addEventListener("abort", cancelAuxiliary, { once: true });
        let completedRun: StoredRun | undefined;
        let receivedResult: AIResult | undefined;
        try {
          emit({
            type: "run",
            run: runView(run),
            ...(inputAttachments.length ? { attachments: inputAttachments } : {}),
          });
          if (!fresh) {
            if (active(run))
              emit({
                type: "error",
                message: "This request already exists. Refresh its saved status; it was not submitted again.",
                run: runView(run),
              });
            else emit({ type: "completed", run: runView(run) });
            return;
          }
          abort.signal.throwIfAborted();
          const context = await executionContext(run);
          abort.signal.throwIfAborted();
          await db
            .update(runs)
            .set({ status: "running", updatedAt: new Date() })
            .where(and(eq(runs.id, run.id), eq(runs.status, "queued"), sql`${runs.expiresAt} > now()`));
          // Optional enrichment must not interrupt or strand the primary execution.
          auxiliaryWork = Promise.resolve()
            .then(() =>
              integration.auxiliary?.(run, auxiliaryAbort.signal, (tx) => authorizeRun(tx, run.ownerId, run.id)),
            )
            .catch(() => undefined);
          const proposals: AssistantProposal[] = [];
          const providerRequest = await integration.buildRequest({ run, ...context, proposals, signal: abort.signal });
          providerRequest.metadata = { ...providerRequest.metadata, feature: integration.key, runId: run.id };
          const { "ai.openaiModel": chatModel } = await loadRuntimeSettings();
          for await (const event of new AIClient(run.provider, { model: String(chatModel.value) }).stream(
            providerRequest,
          )) {
            if (event.type === "text-delta") {
              if (!providerRequest.schema) emit(event);
            } else if (event.type === "output") {
              const text = integration.partialText?.(event.output, run.request);
              if (text !== undefined) emit({ type: "text", text });
            } else if (event.type === "response") {
              await db
                .update(runs)
                .set({
                  providerResponseId: event.response.id || null,
                  model: event.response.model,
                  continuation: sql`${runs.continuation} || ${JSON.stringify({ handles: [event.response.id].filter(Boolean) })}::jsonb`,
                })
                .where(eq(runs.id, run.id));
            } else if (event.type === "completed") {
              abort.signal.throwIfAborted();
              receivedResult = event.result;
              if (event.result.status !== "completed") {
                const error = new AIError(
                  event.result.status === "cancelled" ? "CANCELLED" : "INVALID_OUTPUT",
                  event.result.error?.message ?? "The assistant did not finish its response. Try again.",
                );
                error.usage = event.result.usage;
                throw error;
              }
              providerComplete = true;
              await db
                .update(runs)
                .set({ continuation: sql`${runs.continuation} || '{"resultReceived":true}'::jsonb` })
                .where(eq(runs.id, run.id));
              auxiliaryAbort.abort();
              const auxiliaryResult = await auxiliaryWork;
              completedRun = await finishRun(run.id, event.result, proposals, auxiliaryResult);
              for (const proposal of completedRun.response?.proposals ?? []) emit({ type: "proposal", proposal });
              emit({ type: "completed", run: runView(completedRun) });
            }
          }
          if (!providerComplete) throw new Error("The provider stream ended without a final result.");
        } catch (error) {
          auxiliaryAbort.abort();
          const auxiliaryResult = await auxiliaryWork;
          const message =
            abort.signal.aborted && !providerComplete
              ? "Request cancelled."
              : error instanceof AssistantError || error instanceof AIError
                ? error.message
                : "Generation was interrupted. Your input is saved; try again when ready.";
          const usage = combinedUsage(
            receivedResult?.usage ?? (error instanceof AIError ? error.usage : undefined),
            auxiliaryResult?.usage,
          );
          const [failed] = await db
            .update(runs)
            .set({
              status:
                (abort.signal.aborted && !providerComplete) || (error instanceof AIError && error.code === "CANCELLED")
                  ? "cancelled"
                  : "failed",
              ...(usage ? { usage } : {}),
              errorMessage: message,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(runs.id, run.id),
                sql`${runs.status} IN ('queued','running','unknown')`,
                sql`${runs.expiresAt} > now()`,
                sql`coalesce(${runs.continuation}->>'cleared','false') <> 'true'`,
              ),
            )
            .returning();
          if (failed)
            await db
              .update(messages)
              .set({
                meta: {
                  ...(usage ? { usage } : {}),
                  provider: {
                    name: run.provider,
                    model: receivedResult?.model ?? failed.model,
                    details: auxiliaryResult
                      ? {
                          auxiliary: {
                            model: auxiliaryResult.model,
                            responseId: auxiliaryResult.id,
                            usage: auxiliaryResult.usage,
                          },
                        }
                      : {},
                  },
                },
                updatedAt: new Date(),
              })
              .where(eq(messages.runId, run.id));
          emit({ type: "error", message, ...(failed ? { run: runView(failed) } : {}) });
        } finally {
          requestSignal.removeEventListener("abort", onAbort);
          abort.signal.removeEventListener("abort", cancelAuxiliary);
          try {
            controller.close();
          } catch {
            /* The browser may have disconnected. */
          }
          if (completedRun) await cleanupCompletedResponses(completedRun);
        }
      },
      cancel() {
        onAbort();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  async function cleanupCompletedResponses(run: StoredRun) {
    try {
      const client = new AIClient(run.provider);
      for (const id of handlesOf(run)) await client.deleteResponse(id);
      await db
        .update(runs)
        .set({ continuation: sql`${runs.continuation} || '{"providerDeleted":true}'::jsonb` })
        .where(eq(runs.id, run.id));
    } catch {
      /* Keep handles for resource cleanup retry. */
    }
  }
  async function getRun(actor: string, id: string) {
    return runView(await db.transaction((tx) => authorizeRun(tx, actor, id)));
  }
  async function updateProposal(actor: string, id: string, proposalId: string, input: unknown) {
    const { status } = z
      .object({ status: z.enum(["applied", "discarded", "stale", "failed"]) })
      .strict()
      .parse(input);
    if (!proposalId || proposalId.length > 200) throw new AssistantError("VALIDATION", "Invalid proposal identity.");
    return db.transaction(async (tx) => {
      const run = await authorizeRun(tx, actor, id, true);
      if (run.status !== "completed" || !run.response)
        throw new AssistantError("CONFLICT", "Wait for the complete suggestion before applying it.", 409);
      const proposal = run.response.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new AssistantError("NOT_FOUND", "Proposal not found.", 404);
      if (proposal.status !== "pending" && proposal.status !== status)
        throw new AssistantError("CONFLICT", "This proposal already has a recorded outcome.", 409);
      const response = {
        ...run.response,
        proposals: run.response.proposals.map((item) => (item.id === proposalId ? { ...item, status } : item)),
      };
      const now = new Date();
      const [updated] = await tx.update(runs).set({ response, updatedAt: now }).where(eq(runs.id, id)).returning();
      const [message] = await tx.select().from(messages).where(eq(messages.runId, id));
      if (message)
        await tx
          .update(messages)
          .set({
            parts: parseMessageParts(message.parts).map((part) =>
              part.type === "proposal" && part.proposal.id === proposalId
                ? { ...part, proposal: { ...part.proposal, status } }
                : part,
            ),
            updatedAt: now,
          })
          .where(eq(messages.id, message.id));
      return runView(updated);
    });
  }

  return { startRun, streamRun, getRun, updateProposal, authorizeRun };
}
