import {
  CsvParseError,
  parseStreamingCsv,
  type CsvChunk,
  type ParseStreamingCsvOptions,
  type StreamingCsvResult,
} from "./streaming-csv.ts";
import { BoundedUtf8Preview } from "./bounded-text-preview.ts";
import { createTablePreview } from "./table-preview.ts";
import { getRuntimeLimits } from "../../tool-framework/limits.ts";
import type { ToolResult } from "../../tool-framework/result.ts";
import { ToolError, type ToolRunContext } from "../../tool-framework/run.ts";

export const LARGE_CSV_FILE_BYTES = 2_000_000;

export function isLargeCsvRun(ctx: ToolRunContext<unknown>): boolean {
  return (ctx.input.files?.[0]?.size ?? 0) > LARGE_CSV_FILE_BYTES;
}

async function* fileChunks(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function chunksFor(ctx: ToolRunContext<unknown>): AsyncIterable<CsvChunk> {
  const file = ctx.input.files?.[0];
  if (file) return fileChunks(file.source);
  return (async function* () {
    yield ctx.input.text;
  })();
}

export async function parseCsvRun(
  ctx: ToolRunContext<unknown>,
  options: Omit<ParseStreamingCsvOptions, "signal">,
): Promise<StreamingCsvResult> {
  const total = ctx.input.files?.[0]?.size;
  try {
    return await parseStreamingCsv(chunksFor(ctx), {
      ...options,
      onInputProgress:
        total || options.onInputProgress
          ? (completed) => {
              options.onInputProgress?.(completed);
              if (total) {
                ctx.progress({
                  completed,
                  total,
                  stage: "Processing delimited data",
                  stageMessage: { key: "csv.processing" },
                });
              }
            }
          : undefined,
      signal: ctx.signal,
    });
  } catch (error) {
    if (!(error instanceof CsvParseError)) throw error;
    throw new ToolError(
      `csv-${error.code}`,
      error.message,
      "Check the delimiter, quotes, and field counts, then try again.",
      {
        line: error.row,
        column: error.column,
        messageRef: error.messageRef,
        recoveryMessage: { key: "csv.recovery.structure" },
      },
    );
  }
}

export function serializeCsvRow(row: readonly string[], delimiter: string): string {
  return row
    .map((value) => (value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
    .join(delimiter);
}

export type TextArtifactSink = {
  readonly preview: string;
  readonly previewTruncated: boolean;
  abort(reason?: unknown): Promise<void>;
  finish(): Promise<Awaited<ReturnType<ToolRunContext<unknown>["writeArtifact"]>>>;
  write(value: string): Promise<void>;
};

export function createTextArtifactSink(
  ctx: ToolRunContext<unknown>,
  options: { readonly mime: string; readonly name: string },
): TextArtifactSink {
  const channel = new TransformStream<Uint8Array, Uint8Array>();
  const writer = channel.writable.getWriter();
  const encoder = new TextEncoder();
  const artifactPromise = ctx.writeArtifact({
    ...options,
    source: channel.readable,
  });
  void artifactPromise.catch(() => undefined);
  const preview = new BoundedUtf8Preview(getRuntimeLimits().largeTextPreviewBytes);
  let closed = false;

  return {
    get preview() {
      return preview.value;
    },
    get previewTruncated() {
      return preview.truncated;
    },
    async write(value) {
      ctx.signal.throwIfAborted();
      preview.append(value);
      await writer.write(encoder.encode(value));
    },
    async finish() {
      if (!closed) {
        closed = true;
        await writer.close();
      }
      return artifactPromise;
    },
    async abort(reason) {
      if (!closed) {
        closed = true;
        await writer.abort(reason).catch(() => undefined);
      }
      await artifactPromise.catch(() => undefined);
    },
  };
}

export async function streamCsvRows(
  ctx: ToolRunContext<unknown>,
  options: {
    readonly inputDelimiter: string;
    readonly mapRow?: (row: readonly string[], rowNumber: number) => readonly string[];
    readonly mime: string;
    readonly name: string;
    readonly outputDelimiter: string;
  },
): Promise<ToolResult> {
  const sink = createTextArtifactSink(ctx, options);
  let first = true;
  let preview: ReturnType<typeof createTablePreview> | undefined;
  let parsed: StreamingCsvResult;
  try {
    parsed = await parseCsvRun(ctx, {
      delimiter: options.inputDelimiter,
      onRow: async (row, rowNumber) => {
        const output = options.mapRow?.(row, rowNumber) ?? row;
        if (first) preview = createTablePreview(output);
        else preview?.append(output);
        await sink.write(`${first ? "" : "\n"}${serializeCsvRow(output, options.outputDelimiter)}`);
        first = false;
      },
      previewRows: 0,
    });
  } catch (error) {
    await sink.abort(error);
    throw error;
  }
  const artifact = await sink.finish();
  return {
    render: "code",
    code: sink.preview,
    language: options.outputDelimiter === "\t" ? "tsv" : "csv",
    truncated: sink.previewTruncated,
    tablePreview: preview?.result,
    stats: [
      { label: "Rows", labelMessage: { key: "csv.rows" }, value: String(parsed.rowCount) },
      { label: "Columns", labelMessage: { key: "csv.columns" }, value: String(parsed.columnCount) },
    ],
    sections: [
      {
        title: sink.previewTruncated ? "Complete generated file" : "Download",
        titleMessage: { key: sink.previewTruncated ? "csv.completeFile" : "csv.download" },
        body: {
          render: "files",
          files: [artifact],
          inputBytes: ctx.input.files?.[0]?.size,
          outputBytes: artifact.size,
        },
      },
    ],
  };
}
