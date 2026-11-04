import { getRuntimeLimits } from "./limits.ts";
import { detectMediaKind, validateMediaSignature } from "./media/validation.ts";
import { ToolError, type ToolRunFile } from "./run.ts";
import type { ToolInputSpec, ToolSpec } from "./spec.ts";

const DEFAULT_MAX_FILES = 50;
const SIGNATURE_PREFIX_BYTES = 64 * 1024;

export type FileInputLimits = {
  readonly accept: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
};

function boundedLimit(value: number | undefined): number {
  const { platformMaxBytes } = getRuntimeLimits();
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), platformMaxBytes)
    : platformMaxBytes;
}

export function resolveFileLimits(input: ToolInputSpec): FileInputLimits | null {
  if (input.kind === "files") {
    return {
      accept: input.accept,
      maxBytes: boundedLimit(input.maxBytes),
      maxFiles:
        typeof input.maxFiles === "number" && input.maxFiles > 0
          ? Math.floor(input.maxFiles)
          : input.multiple
            ? DEFAULT_MAX_FILES
            : 1,
      maxTotalBytes: boundedLimit(input.maxTotalBytes),
    };
  }
  if (input.kind === "text" && input.acceptFiles) {
    return {
      accept: input.acceptFiles.accept,
      maxBytes: boundedLimit(input.acceptFiles.maxBytes),
      maxFiles: 1,
      maxTotalBytes: boundedLimit(input.acceptFiles.maxBytes),
    };
  }
  return null;
}

export function assertFileSizes(limits: FileInputLimits, files: readonly { readonly size: number }[]): void {
  if (files.length > limits.maxFiles) {
    throw new ToolError(
      "too-many-files",
      `Choose no more than ${limits.maxFiles} file${limits.maxFiles === 1 ? "" : "s"}.`,
    );
  }
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new ToolError("invalid-size", "A selected file is empty.");
    }
    if (file.size > limits.maxBytes) {
      throw new ToolError(
        "file-too-large",
        `Each file must be ${Math.floor(limits.maxBytes / (1024 * 1024))} MiB or smaller.`,
      );
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > limits.maxTotalBytes) {
    throw new ToolError(
      "total-too-large",
      `Selected files must total ${Math.floor(limits.maxTotalBytes / (1024 * 1024))} MiB or less.`,
      "Remove files or process them in smaller batches.",
    );
  }
}

export async function assertRunnableFiles(
  spec: Pick<ToolSpec, "input">,
  files: readonly ToolRunFile[],
  signal?: AbortSignal,
): Promise<void> {
  const limits = resolveFileLimits(spec.input);
  if (!limits) {
    if (files.length > 0) {
      throw new ToolError("unexpected-files", "This tool does not accept files.");
    }
    return;
  }
  if (spec.input.kind === "files" && files.length === 0) {
    throw new ToolError("no-files", "Choose at least one file.");
  }
  assertFileSizes(limits, files);

  for (const file of files) {
    signal?.throwIfAborted();
    if (file.size !== file.source.size) {
      throw new ToolError("invalid-file", "The selected file metadata is invalid.");
    }
    if (!isAccepted(limits.accept, file.mime, file.name)) {
      throw new ToolError("unsupported-type", "This file type is not supported by this tool.");
    }
    const prefix = new Uint8Array(await file.source.slice(0, SIGNATURE_PREFIX_BYTES).arrayBuffer());
    signal?.throwIfAborted();
    if (spec.input.kind === "files") {
      const signature = validateMediaSignature(prefix, file.mime);
      if (!signature.ok) throw new ToolError(signature.code, signature.message);
      const matchesEngine = spec.input.engine === "pdf" ? signature.kind === "pdf" : signature.kind !== "pdf";
      if (!matchesEngine && (!limits.accept.trim() || !isAccepted(limits.accept, signature.mime, ""))) {
        throw new ToolError("unsupported-type", "This file type is not supported by this tool.");
      }
    } else if (detectMediaKind(prefix)) {
      const signature = validateMediaSignature(prefix, file.mime);
      if (!signature.ok) throw new ToolError(signature.code, signature.message);
    }
  }
}

function isAccepted(accept: string, mime: string, name: string): boolean {
  const entries = accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return true;
  const declaredMime = mime.trim().toLowerCase();
  const fileName = name.toLowerCase();
  return entries.some((entry) =>
    entry.startsWith(".")
      ? fileName.endsWith(entry)
      : entry.endsWith("/*")
        ? declaredMime.startsWith(entry.slice(0, -1))
        : entry === declaredMime,
  );
}
