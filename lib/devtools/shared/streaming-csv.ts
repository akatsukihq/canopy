import { getRuntimeLimits } from "../../tool-framework/limits.ts";
import type { ToolMessage } from "../../tool-runtime/types.ts";

export type CsvChunk = string | Uint8Array;

export type CsvParseErrorCode =
  | "encoding"
  | "unexpected-character"
  | "unexpected-quote"
  | "unclosed-quote"
  | "field-too-large"
  | "row-too-large"
  | "width";

export class CsvParseError extends Error {
  readonly code: CsvParseErrorCode;
  readonly row: number;
  readonly column: number;
  readonly messageRef?: ToolMessage;

  constructor(code: CsvParseErrorCode, message: string, row: number, column: number, messageRef?: ToolMessage) {
    super(message);
    this.name = "CsvParseError";
    this.code = code;
    this.row = row;
    this.column = column;
    this.messageRef = messageRef;
  }
}

export type ParseStreamingCsvOptions = {
  delimiter?: string;
  expectedColumns?: number;
  onRow?: (row: readonly string[], rowNumber: number) => void | Promise<void>;
  /** Receives the cumulative UTF-8 bytes consumed from the input. */
  onInputProgress?: (bytes: number) => void;
  previewRows?: number;
  signal?: AbortSignal;
  validateWidth?: boolean;
  /** Protects the bounded browser preview from pathological single cells. */
  maxPreviewBytes?: number;
  maxFieldBytes?: number;
  maxRowBytes?: number;
};

export type StreamingCsvResult = {
  columnCount: number;
  preview: string[][];
  previewTruncated: boolean;
  rowCount: number;
};

type CsvChunkSource = Iterable<CsvChunk> | AsyncIterable<CsvChunk>;
type FieldState = "after-quote" | "field-start" | "quoted" | "unquoted";

const DEFAULT_PREVIEW_ROWS = 1_000;

export async function parseStreamingCsv(
  source: CsvChunkSource,
  options: ParseStreamingCsvOptions = {},
): Promise<StreamingCsvResult> {
  const {
    delimiter = ",",
    expectedColumns,
    onRow,
    onInputProgress,
    previewRows = DEFAULT_PREVIEW_ROWS,
    signal,
    validateWidth = true,
    maxPreviewBytes = 256 * 1024,
    maxFieldBytes = getRuntimeLimits().csvMaxFieldBytes,
    maxRowBytes = getRuntimeLimits().csvMaxRowBytes,
  } = options;

  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new TypeError("CSV delimiter must be one character other than a quote or newline.");
  }
  if (expectedColumns !== undefined && (!Number.isInteger(expectedColumns) || expectedColumns < 1)) {
    throw new RangeError("expectedColumns must be a positive integer.");
  }
  if (!Number.isInteger(previewRows) || previewRows < 0) {
    throw new RangeError("previewRows must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(maxPreviewBytes) || maxPreviewBytes < 0) {
    throw new RangeError("maxPreviewBytes must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(maxFieldBytes) || maxFieldBytes < 1) {
    throw new RangeError("maxFieldBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxRowBytes) || maxRowBytes < maxFieldBytes) {
    throw new RangeError("maxRowBytes must be at least maxFieldBytes.");
  }

  signal?.throwIfAborted();

  const preview: string[][] = [];
  let columnCount = expectedColumns ?? 0;
  let field = "";
  let fieldBytes = 0;
  let row: string[] = [];
  let rowBytes = 0;
  let rowCount = 0;
  let state: FieldState = "field-start";
  let recordStarted = false;
  let skipLfAfterCr = false;
  let atDocumentStart = true;
  let decoder: TextDecoder | undefined;
  let previewBytes = 0;
  let inputBytes = 0;
  const encoder = new TextEncoder();

  const currentRow = () => rowCount + 1;
  const currentColumn = () => row.length + 1;
  const currentState = (): FieldState => state;

  const appendField = (character: string) => {
    const bytes = encoder.encode(character).byteLength;
    if (fieldBytes + bytes > maxFieldBytes) {
      throw new CsvParseError(
        "field-too-large",
        `Field at row ${currentRow()}, column ${currentColumn()} exceeds the ${maxFieldBytes.toLocaleString("en-US")} byte safety limit.`,
        currentRow(),
        currentColumn(),
        {
          key: "csv.errors.streamFieldTooLarge",
          values: { row: currentRow(), column: currentColumn(), limit: maxFieldBytes },
        },
      );
    }
    if (rowBytes + fieldBytes + bytes > maxRowBytes) {
      throw new CsvParseError(
        "row-too-large",
        `Row ${currentRow()} exceeds the ${maxRowBytes.toLocaleString("en-US")} byte safety limit.`,
        currentRow(),
        currentColumn(),
        {
          key: "csv.errors.streamRowTooLarge",
          values: { row: currentRow(), column: currentColumn(), limit: maxRowBytes },
        },
      );
    }
    field += character;
    fieldBytes += bytes;
  };

  const resetRecord = () => {
    row = [];
    field = "";
    fieldBytes = 0;
    rowBytes = 0;
    state = "field-start";
    recordStarted = false;
  };

  const emitRow = async () => {
    const completedRow = [...row, field];
    const rowNumber = rowCount + 1;

    if (completedRow.every((value) => value === "")) {
      resetRecord();
      return;
    }

    if (!columnCount) columnCount = completedRow.length;
    if (validateWidth && completedRow.length !== columnCount) {
      const errorColumn = completedRow.length < columnCount ? completedRow.length + 1 : columnCount + 1;
      const noun = completedRow.length === 1 ? "column" : "columns";
      const expectedNoun = columnCount === 1 ? "column" : "columns";
      throw new CsvParseError(
        "width",
        `Row ${rowNumber} has ${completedRow.length} ${noun}; expected ${columnCount} ${expectedNoun}.`,
        rowNumber,
        errorColumn,
        {
          key: "csv.errors.streamWidth",
          values: { row: rowNumber, column: errorColumn, actual: completedRow.length, expected: columnCount },
        },
      );
    }

    rowCount = rowNumber;
    if (preview.length < previewRows) {
      const nextBytes = completedRow.reduce((total, value) => total + encoder.encode(value).byteLength, 0);
      if (nextBytes <= maxPreviewBytes - previewBytes) {
        preview.push(completedRow.slice());
        previewBytes += nextBytes;
      }
    }
    await onRow?.(completedRow.slice(), rowNumber);
    signal?.throwIfAborted();

    resetRecord();
  };

  const consumeText = async (value: string) => {
    let text = value;
    if (atDocumentStart && text) {
      if (text[0] === "\uFEFF") text = text.slice(1);
      atDocumentStart = false;
    }

    for (const character of text) {
      if (skipLfAfterCr) {
        skipLfAfterCr = false;
        if (character === "\n") continue;
      }

      if (state === "quoted") {
        if (character === '"') {
          state = "after-quote";
        } else {
          appendField(character);
        }
        continue;
      }

      if (state === "after-quote") {
        if (character === '"') {
          appendField('"');
          state = "quoted";
          continue;
        }
        if (character !== delimiter && character !== "\r" && character !== "\n") {
          throw new CsvParseError(
            "unexpected-character",
            `Unexpected character ${JSON.stringify(character)} after a closing quote at row ${currentRow()}, column ${currentColumn()}.`,
            currentRow(),
            currentColumn(),
            {
              key: "csv.errors.streamUnexpectedCharacter",
              values: { character: JSON.stringify(character), row: currentRow(), column: currentColumn() },
            },
          );
        }
      }

      if (character === delimiter) {
        row.push(field);
        rowBytes += fieldBytes;
        field = "";
        fieldBytes = 0;
        state = "field-start";
        recordStarted = true;
      } else if (character === "\r" || character === "\n") {
        await emitRow();
        skipLfAfterCr = character === "\r";
      } else if (character === '"') {
        if (state !== "field-start") {
          throw new CsvParseError(
            "unexpected-quote",
            `Unexpected quote at row ${currentRow()}, column ${currentColumn()}. Quotes must start at the beginning of a field.`,
            currentRow(),
            currentColumn(),
            { key: "csv.errors.streamUnexpectedQuote", values: { row: currentRow(), column: currentColumn() } },
          );
        }
        state = "quoted";
        recordStarted = true;
      } else {
        appendField(character);
        state = "unquoted";
        recordStarted = true;
      }
    }
  };

  const decode = (chunk?: Uint8Array) => {
    try {
      if (!decoder) {
        decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: !atDocumentStart,
        });
      }
      return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    } catch {
      throw new CsvParseError(
        "encoding",
        `Invalid UTF-8 at row ${currentRow()}, column ${currentColumn()}.`,
        currentRow(),
        currentColumn(),
        { key: "csv.errors.streamEncoding", values: { row: currentRow(), column: currentColumn() } },
      );
    }
  };

  for await (const chunk of source) {
    signal?.throwIfAborted();
    if (typeof chunk === "string") {
      inputBytes += encoder.encode(chunk).byteLength;
      onInputProgress?.(inputBytes);
      if (decoder) {
        await consumeText(decode());
        decoder = undefined;
      }
      await consumeText(chunk);
    } else if (chunk instanceof Uint8Array) {
      inputBytes += chunk.byteLength;
      onInputProgress?.(inputBytes);
      await consumeText(decode(chunk));
    } else {
      throw new TypeError("CSV chunks must be strings or Uint8Array values.");
    }
  }

  if (decoder) await consumeText(decode());
  signal?.throwIfAborted();

  if (currentState() === "quoted") {
    throw new CsvParseError(
      "unclosed-quote",
      `Unclosed quoted field at row ${currentRow()}, column ${currentColumn()}.`,
      currentRow(),
      currentColumn(),
      { key: "csv.errors.streamUnclosedQuote", values: { row: currentRow(), column: currentColumn() } },
    );
  }
  if (recordStarted || row.length || field) await emitRow();

  return {
    columnCount,
    preview,
    previewTruncated: rowCount > preview.length,
    rowCount,
  };
}
