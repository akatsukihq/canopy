import { sanitizeFileName } from "./media/validation.ts";
import { BLOB_FALLBACK_MAX_BYTES, getRuntimeLimits, PLATFORM_MAX_BYTES } from "./limits.ts";

export { BLOB_FALLBACK_MAX_BYTES, PLATFORM_MAX_BYTES } from "./limits.ts";
export const PLATFORM_MAX_OUTPUT_BYTES = PLATFORM_MAX_BYTES;
export const ARTIFACT_STALE_MS = 24 * 60 * 60 * 1000;

const ROOT_DIRECTORY = "smarttools";
const JOBS_DIRECTORY = "jobs";
const CREATED_AT_FILE = ".created-at";
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type ArtifactStorageErrorCode =
  | "invalid-artifact"
  | "output-too-large"
  | "storage-unavailable"
  | "storage-full"
  | "artifact-write-failed"
  | "artifact-not-found"
  | "artifact-corrupt";

export class ArtifactStorageError extends Error {
  readonly code: ArtifactStorageErrorCode;

  constructor(code: ArtifactStorageErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ArtifactStorageError";
    this.code = code;
  }
}

type StoredArtifactCommon = {
  readonly id: string;
  readonly jobId: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly createdAt: number;
};

export type OpfsStoredArtifact = StoredArtifactCommon & {
  readonly storage: "opfs";
};

export type BlobStoredArtifact = StoredArtifactCommon & {
  readonly storage: "blob";
  readonly blob: Blob;
};

/** Both variants are structured-cloneable across the worker boundary. */
export type StoredToolArtifact = OpfsStoredArtifact | BlobStoredArtifact;

export type ArtifactSource = Blob | Uint8Array | ReadableStream<Uint8Array>;

export type ArtifactWriteInput = {
  readonly name: string;
  readonly mime: string;
  readonly source: ArtifactSource;
};

export type ArtifactWriter = {
  readonly bytesWritten: number;
  write(input: ArtifactWriteInput): Promise<StoredToolArtifact>;
};

export type ArtifactWriterOptions = {
  readonly maxOutputBytes?: number;
  readonly onStorageWarning?: (warning: ArtifactStorageWarning) => void;
  readonly signal?: AbortSignal;
};

export type ArtifactStorageWarning = {
  readonly availableBytes: number;
  readonly requiredBytes: number;
  readonly message: string;
};

export function createArtifactWriter(jobId: string, options: ArtifactWriterOptions = {}): ArtifactWriter {
  const safeJobId = assertSafeId(jobId, "Artifact job ID");
  const maxOutputBytes = normalizeLimit(options.maxOutputBytes);
  const createdAt = Date.now();
  let committedBytes = 0;
  let blobFallbackBytes = 0;
  let tail = Promise.resolve();

  return {
    get bytesWritten() {
      return committedBytes;
    },
    write(input) {
      const operation = tail.then(async () => {
        options.signal?.throwIfAborted();
        await warnAboutStoragePressure(input.source, options.onStorageWarning);
        const artifact = await writeArtifact({
          input: normalizeInput(input),
          jobId: safeJobId,
          createdAt,
          remainingBytes: maxOutputBytes - committedBytes,
          signal: options.signal,
          remainingBlobFallbackBytes: getRuntimeLimits().blobFallbackMaxBytes - blobFallbackBytes,
        });
        committedBytes += artifact.size;
        if (artifact.storage === "blob") blobFallbackBytes += artifact.size;
        return artifact;
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}

async function warnAboutStoragePressure(
  source: ArtifactSource,
  onWarning: ArtifactWriterOptions["onStorageWarning"],
): Promise<void> {
  if (!onWarning || typeof navigator === "undefined") return;
  const requiredBytes = source instanceof Blob ? source.size : source instanceof Uint8Array ? source.byteLength : null;
  if (requiredBytes === null) return;
  const estimate = navigator.storage?.estimate;
  if (typeof estimate !== "function") return;

  try {
    const { quota, usage } = await estimate.call(navigator.storage);
    if (typeof quota !== "number" || typeof usage !== "number" || !Number.isFinite(quota) || !Number.isFinite(usage))
      return;
    const availableBytes = Math.max(0, quota - usage);
    if (availableBytes >= requiredBytes) return;
    onWarning({
      availableBytes,
      requiredBytes,
      message: "Browser storage may be low. The tool will still try to save the result.",
    });
  } catch {
    // Estimates are advisory. A missing or failed estimate must never block a write.
  }
}

export async function readArtifact(artifact: StoredToolArtifact): Promise<File> {
  const metadata = normalizeStoredArtifact(artifact);
  if (metadata.storage === "blob") {
    if (metadata.blob.size !== metadata.size) {
      throw new ArtifactStorageError("artifact-corrupt", "The generated file is incomplete. Run the tool again.");
    }
    return new File([metadata.blob], metadata.name, { type: metadata.mime });
  }

  const root = await getOpfsRoot();
  if (!root) {
    throw new ArtifactStorageError("storage-unavailable", "Browser storage is unavailable. Run the tool again.");
  }
  try {
    const job = await getJobDirectory(root, metadata.jobId);
    const handle = await job.getFileHandle(metadata.id);
    const stored = await handle.getFile();
    if (stored.size !== metadata.size) {
      throw new ArtifactStorageError("artifact-corrupt", "The generated file is incomplete. Run the tool again.");
    }
    return new File([stored], metadata.name, {
      type: metadata.mime,
      lastModified: stored.lastModified,
    });
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    if (isNamedError(error, "NotFoundError")) {
      throw new ArtifactStorageError(
        "artifact-not-found",
        "The generated file is no longer available. Run the tool again.",
        error,
      );
    }
    throw storageError(error);
  }
}

export async function cleanupArtifactJob(jobId: string): Promise<void> {
  const safeJobId = assertSafeId(jobId, "Artifact job ID");
  const root = await getOpfsRoot();
  if (!root) return;
  const jobs = await getJobsDirectory(root, false);
  if (!jobs) return;
  try {
    await jobs.removeEntry(safeJobId, { recursive: true });
  } catch (error) {
    if (!isNamedError(error, "NotFoundError")) throw storageError(error);
  }
}

export async function cleanupArtifactJobWithRetry(
  jobId: string,
  options: {
    readonly attempts?: number;
    readonly retryDelayMs?: number;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 100;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("Artifact cleanup attempts must be a positive integer.");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("Artifact cleanup delay must be finite and non-negative.");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await cleanupArtifactJob(jobId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(retryDelayMs);
    }
  }
  throw lastError;
}

let staleSweepPromise: Promise<number> | null = null;

/** Coalesces the stale-job sweep across every tool page mounted in this tab. */
export function sweepStaleArtifactJobsOnce(): Promise<number> {
  if (!staleSweepPromise) {
    staleSweepPromise = sweepStaleArtifactJobs().catch((error) => {
      staleSweepPromise = null;
      throw error;
    });
  }
  return staleSweepPromise;
}

export async function sweepStaleArtifactJobs(
  options: { readonly now?: number; readonly maxAgeMs?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? ARTIFACT_STALE_MS;
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new RangeError("Artifact sweep timing must be finite and non-negative.");
  }
  const root = await getOpfsRoot();
  if (!root) return 0;
  const jobs = await getJobsDirectory(root, false);
  if (!jobs) return 0;

  let removed = 0;
  for await (const [name, entry] of jobs.entries()) {
    if (entry.kind !== "directory" || !SAFE_ID_PATTERN.test(name)) continue;
    const createdAt = await readCreatedAt(entry);
    if (createdAt === null || now - createdAt <= maxAgeMs) continue;
    try {
      await jobs.removeEntry(name, { recursive: true });
      removed += 1;
    } catch (error) {
      if (!isNamedError(error, "NotFoundError")) throw storageError(error);
    }
  }
  return removed;
}

type WriteState = {
  readonly input: ArtifactWriteInput;
  readonly jobId: string;
  readonly createdAt: number;
  readonly remainingBytes: number;
  readonly remainingBlobFallbackBytes: number;
  readonly signal?: AbortSignal;
};

async function writeArtifact(state: WriteState): Promise<StoredToolArtifact> {
  if (state.remainingBytes < 0) throwOutputTooLarge();
  const id = crypto.randomUUID();
  const root = await getOpfsRoot();
  if (!root) return writeBlobFallback(state, id);

  const replay = createReplayBuffer(state.input.source);
  let job: FileSystemDirectoryHandle | null = null;
  try {
    job = await createJobDirectory(root, state.jobId, state.createdAt);
    const size = await writeOpfsFile(job, id, state, replay);
    return {
      storage: "opfs",
      id,
      jobId: state.jobId,
      name: state.input.name,
      mime: state.input.mime,
      size,
      createdAt: state.createdAt,
    };
  } catch (error) {
    if (job) await removeEntry(job, id);
    if (isNamedError(error, "AbortError")) throw error;
    if (error instanceof ArtifactStorageError && error.code === "output-too-large") throw error;
    const buffered = replay.toBlob(state.input.mime);
    if (buffered) return blobArtifact(state, id, buffered);
    throw storageError(error);
  }
}

async function writeOpfsFile(
  job: FileSystemDirectoryHandle,
  id: string,
  state: WriteState,
  replay: ReplayBuffer,
): Promise<number> {
  const handle = await job.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  const reader = sourceStream(state.input.source).getReader();
  let written = 0;
  let committed = false;
  try {
    while (true) {
      state.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        replay.complete();
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new ArtifactStorageError("invalid-artifact", "Artifact streams must contain byte chunks.");
      }
      if (value.byteLength > state.remainingBytes - written) throwOutputTooLarge();
      replay.add(value);
      await writable.write(copyBytes(value));
      written += value.byteLength;
    }
    state.signal?.throwIfAborted();
    await writable.close();
    committed = true;
    const file = await handle.getFile();
    if (file.size !== written) {
      throw new ArtifactStorageError("artifact-write-failed", "The generated file could not be saved completely.");
    }
    return written;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (!committed) await writable.abort().catch(() => undefined);
  }
}

async function writeBlobFallback(state: WriteState, id: string): Promise<BlobStoredArtifact> {
  const reader = sourceStream(state.input.source).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      state.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new ArtifactStorageError("invalid-artifact", "Artifact streams must contain byte chunks.");
      }
      if (value.byteLength > state.remainingBytes - size) throwOutputTooLarge();
      if (value.byteLength > state.remainingBlobFallbackBytes - size) {
        throw new ArtifactStorageError(
          "storage-unavailable",
          "Browser storage is unavailable for this generated file. Free storage or use a supported browser.",
        );
      }
      chunks.push(copyBytes(value));
      size += value.byteLength;
    }
    return blobArtifact(state, id, new Blob(chunks, { type: state.input.mime }));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function blobArtifact(state: WriteState, id: string, blob: Blob): BlobStoredArtifact {
  if (blob.size > state.remainingBytes) throwOutputTooLarge();
  if (blob.size > state.remainingBlobFallbackBytes) {
    throw new ArtifactStorageError(
      "storage-unavailable",
      "Browser storage is unavailable for this generated file. Free storage or use a supported browser.",
    );
  }
  return {
    storage: "blob",
    id,
    jobId: state.jobId,
    name: state.input.name,
    mime: state.input.mime,
    size: blob.size,
    createdAt: state.createdAt,
    blob,
  };
}

async function createJobDirectory(
  root: FileSystemDirectoryHandle,
  jobId: string,
  createdAt: number,
): Promise<FileSystemDirectoryHandle> {
  const jobs = await getJobsDirectory(root, true);
  if (!jobs) throw new ArtifactStorageError("storage-unavailable", "Browser storage is unavailable.");
  let job: FileSystemDirectoryHandle;
  try {
    job = await jobs.getDirectoryHandle(jobId);
    return job;
  } catch (error) {
    if (!isNamedError(error, "NotFoundError")) throw error;
    job = await jobs.getDirectoryHandle(jobId, { create: true });
  }
  try {
    const marker = await job.getFileHandle(CREATED_AT_FILE, { create: true });
    const writable = await marker.createWritable();
    let closed = false;
    try {
      await writable.write(new TextEncoder().encode(String(createdAt)));
      await writable.close();
      closed = true;
    } finally {
      if (!closed) await writable.abort().catch(() => undefined);
    }
    return job;
  } catch (error) {
    await jobs.removeEntry(jobId, { recursive: true }).catch(() => undefined);
    throw error;
  }
}

async function getJobsDirectory(
  root: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const app = await root.getDirectoryHandle(ROOT_DIRECTORY, { create });
    return await app.getDirectoryHandle(JOBS_DIRECTORY, { create });
  } catch (error) {
    if (!create && isNamedError(error, "NotFoundError")) return null;
    throw error;
  }
}

async function getJobDirectory(root: FileSystemDirectoryHandle, jobId: string): Promise<FileSystemDirectoryHandle> {
  const jobs = await getJobsDirectory(root, false);
  if (!jobs) throw new DOMException("Missing", "NotFoundError");
  return jobs.getDirectoryHandle(jobId);
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const getDirectory = navigator.storage?.getDirectory;
  if (typeof getDirectory !== "function") return null;
  try {
    return await getDirectory.call(navigator.storage);
  } catch {
    return null;
  }
}

async function readCreatedAt(job: FileSystemDirectoryHandle): Promise<number | null> {
  try {
    const marker = await job.getFileHandle(CREATED_AT_FILE);
    const value = Number(await (await marker.getFile()).text());
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function removeEntry(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!isNamedError(error, "NotFoundError")) {
      // Best-effort cleanup must not hide the original write failure.
    }
  }
}

function sourceStream(source: ArtifactSource): ReadableStream<Uint8Array> {
  if (source instanceof Blob) return source.stream();
  if (source instanceof Uint8Array) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(source);
        controller.close();
      },
    });
  }
  if (source instanceof ReadableStream) return source;
  throw new ArtifactStorageError("invalid-artifact", "Artifact source must contain bytes.");
}

type ReplayBuffer = {
  add(chunk: Uint8Array): void;
  complete(): void;
  toBlob(mime: string): Blob | null;
};

function createReplayBuffer(source: ArtifactSource): ReplayBuffer {
  const blobFallbackMax = getRuntimeLimits().blobFallbackMaxBytes;
  if (source instanceof Blob) {
    return {
      add() {},
      complete() {},
      toBlob: (mime) => (source.size <= blobFallbackMax ? source.slice(0, source.size, mime) : null),
    };
  }
  if (source instanceof Uint8Array) {
    return {
      add() {},
      complete() {},
      toBlob: (mime) =>
        source.byteLength <= blobFallbackMax ? new Blob([copyBytes(source)], { type: mime }) : null,
    };
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let overflowed = false;
  let completed = false;
  return {
    add(chunk) {
      if (overflowed || chunk.byteLength > blobFallbackMax - size) {
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(copyBytes(chunk));
      size += chunk.byteLength;
    },
    complete() {
      completed = true;
    },
    toBlob(mime) {
      return overflowed || !completed ? null : new Blob(chunks, { type: mime });
    },
  };
}

function normalizeInput(input: ArtifactWriteInput): ArtifactWriteInput {
  const name = sanitizeFileName(input.name);
  const mime = input.mime.trim().toLowerCase();
  if (!MIME_PATTERN.test(mime)) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact MIME type is invalid.");
  }
  return { name, mime, source: input.source };
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function normalizeStoredArtifact(artifact: StoredToolArtifact): StoredToolArtifact {
  if (!artifact || (artifact.storage !== "opfs" && artifact.storage !== "blob")) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact metadata is invalid.");
  }
  assertSafeId(artifact.id, "Artifact ID");
  assertSafeId(artifact.jobId, "Artifact job ID");
  if (!Number.isInteger(artifact.size) || artifact.size < 0 || artifact.size > getRuntimeLimits().platformMaxBytes) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact size is invalid.");
  }
  if (!Number.isFinite(artifact.createdAt) || artifact.createdAt < 0) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact timestamp is invalid.");
  }
  if (!MIME_PATTERN.test(artifact.mime) || sanitizeFileName(artifact.name) !== artifact.name) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact metadata is invalid.");
  }
  if (artifact.storage === "blob" && !(artifact.blob instanceof Blob)) {
    throw new ArtifactStorageError("invalid-artifact", "Artifact data is invalid.");
  }
  return artifact;
}

function normalizeLimit(limit = getRuntimeLimits().platformMaxBytes): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Maximum artifact output must be a positive integer.");
  }
  return Math.min(limit, getRuntimeLimits().platformMaxBytes);
}

function assertSafeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function throwOutputTooLarge(): never {
  throw new ArtifactStorageError("output-too-large", "Generated files must total 100 MiB or less.");
}

function storageError(error: unknown): ArtifactStorageError {
  if (error instanceof ArtifactStorageError) return error;
  if (isNamedError(error, "QuotaExceededError")) {
    return new ArtifactStorageError(
      "storage-full",
      "Browser storage is full. Free space and run the tool again.",
      error,
    );
  }
  if (
    isNamedError(error, "SecurityError") ||
    isNamedError(error, "NotAllowedError") ||
    isNamedError(error, "InvalidStateError")
  ) {
    return new ArtifactStorageError(
      "storage-unavailable",
      "Browser storage is unavailable. Run the tool again in a supported browsing context.",
      error,
    );
  }
  return new ArtifactStorageError("artifact-write-failed", "The generated file could not be saved.", error);
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof DOMException
    ? error.name === name
    : typeof error === "object" && error !== null && "name" in error && error.name === name;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
