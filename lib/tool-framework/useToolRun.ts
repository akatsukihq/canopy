"use client";

/**
 * Spawns the one tool worker and drives a single job through it.
 *
 * The `new URL("./tool.worker.ts", import.meta.url)` below must stay written
 * out literally — that inline form is the only shape a bundler recognises as a
 * worker entry. Nothing worker-only may be imported here.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CANCEL_WATCHDOG_MS, PDF_THUMBNAIL_CACHE_SIZE } from "./limits";
import { cleanupArtifactJobWithRetry } from "./artifacts";
import type { ToolPagePreview } from "./run";
import type { ToolSpec } from "./spec";
import {
  beginWorkerJob,
  cancelWorkerJob,
  createToolInspectionCloseRequest,
  createToolInspectRequest,
  createToolJobState,
  createToolWorkerRequest,
  createToolThumbnailRequest,
  isToolWorkerResponse,
  reduceWorkerJobState,
  type ToolInspectRequestInput,
  type ToolJobState,
  type ToolRunRequestInput,
  type ToolWorkerMessage,
} from "./workerProtocol";

export type ToolRunHandle = {
  readonly state: ToolJobState;
  /** Page geometry from the last completed inspection; empty until then. */
  readonly previews: readonly ToolPagePreview[];
  /** Starts a job, replacing any job already running. Returns its id. */
  readonly start: (request: ToolRunRequestInput) => string;
  /** Starts a page inspection, replacing any job already running. */
  readonly inspect: (request: ToolInspectRequestInput) => string;
  /** Requests raster bytes for pages in or near the page-picker viewport. */
  readonly requestThumbnails: (pageNumbers: readonly number[], renderWidth?: number) => void;
  /** Closes the open inspection document while retaining its page geometry. */
  readonly closeInspection: () => void;
  readonly cancel: () => void;
  /** Releases one completed result, or every retained result when omitted. */
  readonly cleanupArtifacts: (jobId?: string) => void;
  readonly reset: () => void;
};

/** `spec` is attached to every run and inspection; the worker has no other copy. */
export function useToolRun(spec?: ToolSpec): ToolRunHandle {
  const [state, setState] = useState<ToolJobState>(createToolJobState);
  const stateRef = useRef(state);
  const workerRef = useRef<Worker | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The runtime owns when a displayed result is replaced. Keep every delivered
  // result alive until it releases it, or this host resets/unmounts.
  const completedArtifactJobs = useRef(new Set<string>());
  const inspectionRef = useRef<{
    readonly jobId: string;
    readonly inFlight: Set<number>;
  } | null>(null);

  const apply = useCallback((next: ToolJobState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const terminate = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    inspectionRef.current = null;
  }, []);

  const cleanupJob = useCallback((jobId: string | null) => {
    if (!jobId) return;
    completedArtifactJobs.current.delete(jobId);
    void cleanupArtifactJobWithRetry(jobId).catch(() => undefined);
  }, []);

  const abortWorker = useCallback((jobId: string | null) => {
    if (jobId && workerRef.current) {
      workerRef.current.postMessage({ type: "cancel", jobId });
    }
  }, []);

  const cleanupCurrentArtifacts = useCallback(
    (completedJobId?: string) => {
      if (completedJobId !== undefined) {
        if (completedArtifactJobs.current.has(completedJobId)) cleanupJob(completedJobId);
        return;
      }
      for (const jobId of completedArtifactJobs.current) cleanupJob(jobId);
      const { jobId, status } = stateRef.current;
      if (status === "completed") cleanupJob(jobId);
    },
    [cleanupJob],
  );

  useEffect(
    () => () => {
      const jobId = stateRef.current.jobId;
      const currentWorker = workerRef.current;
      if (jobId && currentWorker && inspectionRef.current?.jobId === jobId) {
        currentWorker.postMessage(createToolInspectionCloseRequest(jobId));
        window.setTimeout(() => currentWorker.terminate(), CANCEL_WATCHDOG_MS);
        workerRef.current = null;
        inspectionRef.current = null;
      } else {
        abortWorker(jobId);
        terminate();
      }
      cleanupJob(jobId);
      for (const completedJobId of completedArtifactJobs.current) cleanupJob(completedJobId);
    },
    [abortWorker, cleanupJob, terminate],
  );

  /** One job at a time: every dispatch replaces the worker and the job state. */
  const dispatch = useCallback(
    (message: ToolWorkerMessage): string => {
      const previousJobId = stateRef.current.jobId;
      const previousInspection = inspectionRef.current;
      const inspectionWorker = workerRef.current;
      if (message.type === "inspect" && previousInspection && inspectionWorker) {
        cleanupJob(previousJobId);
        apply(beginWorkerJob(stateRef.current, message.jobId));
        inspectionRef.current = { jobId: message.jobId, inFlight: new Set() };
        // `inspectJob` closes the previous range-backed document before opening
        // this one, so a selection change does not rely on abrupt termination.
        inspectionWorker.postMessage(message);
        return message.jobId;
      }
      abortWorker(previousJobId);
      terminate();
      if (!previousJobId || !completedArtifactJobs.current.has(previousJobId)) cleanupJob(previousJobId);
      const worker = new Worker(new URL("./tool.worker.ts", import.meta.url), {
        name: "canopy-tool-worker",
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isToolWorkerResponse(event.data)) return;
        if (workerRef.current !== worker || stateRef.current.jobId !== event.data.jobId) {
          if (event.data.type === "success" && !completedArtifactJobs.current.has(event.data.jobId))
            cleanupJob(event.data.jobId);
          return;
        }
        if (event.data.type === "inspection-closed") {
          terminate();
          return;
        }
        if (event.data.type === "thumbnails") {
          const session = inspectionRef.current;
          if (!session || session.jobId !== event.data.jobId) return;
          for (const preview of event.data.previews) {
            session.inFlight.delete(preview.pageNumber);
          }
          apply(reduceWorkerJobState(stateRef.current, event.data));
          return;
        }
        const next = reduceWorkerJobState(stateRef.current, event.data);
        if (event.data.type === "success") {
          if (next.status === "completed") completedArtifactJobs.current.add(event.data.jobId);
          else cleanupJob(event.data.jobId);
        } else if (event.data.type === "failure" || event.data.type === "canceled") {
          cleanupJob(event.data.jobId);
        }
        if (event.data.type === "inspected" && next.status === "completed") {
          inspectionRef.current = {
            jobId: event.data.jobId,
            inFlight: new Set(),
          };
        } else if (next.status !== "running") {
          terminate();
        }
        apply(next);
      };
      apply(beginWorkerJob(stateRef.current, message.jobId));
      if (message.type === "inspect") {
        inspectionRef.current = { jobId: message.jobId, inFlight: new Set() };
      }
      worker.postMessage(message);
      return message.jobId;
    },
    [abortWorker, apply, cleanupJob, terminate],
  );

  const start = useCallback(
    (request: ToolRunRequestInput): string => {
      const message = createToolWorkerRequest({
        ...request,
        spec: request.spec ?? spec,
        jobId: crypto.randomUUID(),
      });
      return dispatch(message);
    },
    [dispatch, spec],
  );

  const inspect = useCallback(
    (request: ToolInspectRequestInput): string =>
      dispatch(createToolInspectRequest({ ...request, spec: request.spec ?? spec, jobId: crypto.randomUUID() })),
    [dispatch, spec],
  );

  const requestThumbnails = useCallback((pageNumbers: readonly number[], renderWidth?: number) => {
    const session = inspectionRef.current;
    const worker = workerRef.current;
    const current = stateRef.current;
    if (!session || !worker || current.jobId !== session.jobId || current.status !== "completed") {
      return;
    }
    const geometryPages = new Set(current.previews.map((preview) => preview.pageNumber));
    const bufferedPages = new Set(
      current.previews
        .filter((preview) => {
          const buffer = (preview as { readonly buffer?: unknown }).buffer;
          const renderedWidth = (preview as { readonly renderWidth?: number }).renderWidth ?? 0;
          return buffer instanceof ArrayBuffer && (renderWidth === undefined || renderedWidth >= renderWidth);
        })
        .map((preview) => preview.pageNumber),
    );
    const room = PDF_THUMBNAIL_CACHE_SIZE - session.inFlight.size;
    if (room < 1) return;
    const requested = [...new Set(pageNumbers)]
      .filter(
        (pageNumber) =>
          geometryPages.has(pageNumber) && !bufferedPages.has(pageNumber) && !session.inFlight.has(pageNumber),
      )
      .slice(0, room);
    if (requested.length === 0) return;
    for (const pageNumber of requested) session.inFlight.add(pageNumber);
    worker.postMessage(createToolThumbnailRequest({ jobId: session.jobId, pageNumbers: requested, renderWidth }));
  }, []);

  const closeInspection = useCallback(() => {
    const session = inspectionRef.current;
    const worker = workerRef.current;
    if (!session || !worker) return;
    inspectionRef.current = null;
    worker.postMessage(createToolInspectionCloseRequest(session.jobId));
    watchdogRef.current = setTimeout(() => {
      if (workerRef.current === worker) terminate();
    }, CANCEL_WATCHDOG_MS);
  }, [terminate]);

  const cancel = useCallback(() => {
    const canceled = cancelWorkerJob(stateRef.current);
    if (!canceled) return;
    workerRef.current?.postMessage(canceled.message);
    apply(canceled.state);
    watchdogRef.current = setTimeout(() => {
      terminate();
      cleanupJob(canceled.message.jobId);
    }, CANCEL_WATCHDOG_MS);
  }, [apply, cleanupJob, terminate]);

  const reset = useCallback(() => {
    const jobId = stateRef.current.jobId;
    const session = inspectionRef.current;
    if (session && workerRef.current) {
      closeInspection();
    } else {
      abortWorker(jobId);
      terminate();
    }
    cleanupJob(jobId);
    for (const completedJobId of completedArtifactJobs.current) cleanupJob(completedJobId);
    apply(createToolJobState());
  }, [abortWorker, apply, cleanupJob, closeInspection, terminate]);

  return {
    state,
    previews: state.previews,
    start,
    inspect,
    requestThumbnails,
    closeInspection,
    cancel,
    cleanupArtifacts: cleanupCurrentArtifacts,
    reset,
  };
}
