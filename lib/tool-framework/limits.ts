export const MIB = 1024 * 1024;

/** Hard admission ceiling for one input file and one job's total I/O. */
export const PLATFORM_MAX_BYTES = 100 * MIB;

/** Maximum aggregate output retained in memory when OPFS is unavailable. */
export const BLOB_FALLBACK_MAX_BYTES = 16 * MIB;

/** Complete text stays editable only up to the existing character ceiling. */
export const MAX_EDITABLE_TEXT_CHARS = 2_000_000;

/** A large text file is represented by a bounded, read-only preview. */
export const LARGE_TEXT_PREVIEW_BYTES = 256 * 1024;

export const CSV_PREVIEW_ROWS = 1_000;
/** Keeps a 1,000-row CSV preview useful while bounding retained DOM text. */
export const CSV_PREVIEW_BYTES = 2 * MIB;
/** One pathological field or row must not consume the whole browser heap. */
export const CSV_MAX_FIELD_BYTES = 8 * MIB;
export const CSV_MAX_ROW_BYTES = 16 * MIB;
export const PDF_THUMBNAIL_CACHE_SIZE = 24;
export const PDF_PREVIEW_MAX_WIDTH = 4096;
export const PDF_PREVIEW_MAX_PIXELS = 8_000_000;
export const PDF_PREVIEW_CACHE_PIXELS = 32_000_000;
export const PROGRESS_INTERVAL_MS = 100;
export const CANCEL_WATCHDOG_MS = 1_000;

/**
 * Limits in force for the current page or worker. The constants above are both
 * the fallback (no database, missing or invalid row) and the hard ceiling: an
 * admin may lower a limit but never raise it past the memory/browser safety
 * margin the constant was sized for. Raising a ceiling is a code change.
 */
export type RuntimeLimits = {
  readonly platformMaxBytes: number;
  readonly blobFallbackMaxBytes: number;
  readonly maxEditableTextChars: number;
  readonly largeTextPreviewBytes: number;
  readonly csvPreviewRows: number;
  readonly csvPreviewBytes: number;
  readonly csvMaxFieldBytes: number;
  readonly csvMaxRowBytes: number;
  readonly pdfThumbnailCacheSize: number;
  readonly pdfPreviewMaxWidth: number;
  readonly pdfPreviewMaxPixels: number;
  readonly pdfPreviewCachePixels: number;
};

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  platformMaxBytes: PLATFORM_MAX_BYTES,
  blobFallbackMaxBytes: BLOB_FALLBACK_MAX_BYTES,
  maxEditableTextChars: MAX_EDITABLE_TEXT_CHARS,
  largeTextPreviewBytes: LARGE_TEXT_PREVIEW_BYTES,
  csvPreviewRows: CSV_PREVIEW_ROWS,
  csvPreviewBytes: CSV_PREVIEW_BYTES,
  csvMaxFieldBytes: CSV_MAX_FIELD_BYTES,
  csvMaxRowBytes: CSV_MAX_ROW_BYTES,
  pdfThumbnailCacheSize: PDF_THUMBNAIL_CACHE_SIZE,
  pdfPreviewMaxWidth: PDF_PREVIEW_MAX_WIDTH,
  pdfPreviewMaxPixels: PDF_PREVIEW_MAX_PIXELS,
  pdfPreviewCachePixels: PDF_PREVIEW_CACHE_PIXELS,
};

/** `system_limits.key` for each field; the single mapping the database, Admin and runtime share. */
export const RUNTIME_LIMIT_KEYS: Readonly<Record<keyof RuntimeLimits, string>> = {
  platformMaxBytes: "platform_max_bytes",
  blobFallbackMaxBytes: "blob_fallback_max_bytes",
  maxEditableTextChars: "max_editable_text_chars",
  largeTextPreviewBytes: "large_text_preview_bytes",
  csvPreviewRows: "csv_preview_rows",
  csvPreviewBytes: "csv_preview_bytes",
  csvMaxFieldBytes: "csv_max_field_bytes",
  csvMaxRowBytes: "csv_max_row_bytes",
  pdfThumbnailCacheSize: "pdf_thumbnail_cache_size",
  pdfPreviewMaxWidth: "pdf_preview_max_width",
  pdfPreviewMaxPixels: "pdf_preview_max_pixels",
  pdfPreviewCachePixels: "pdf_preview_cache_pixels",
};

const FIELDS = Object.keys(DEFAULT_RUNTIME_LIMITS) as (keyof RuntimeLimits)[];

/** Ceiling (= code constant) per `system_limits.key`. */
export const LIMIT_CEILINGS: Readonly<Record<string, number>> = Object.fromEntries(
  FIELDS.map((field) => [RUNTIME_LIMIT_KEYS[field], DEFAULT_RUNTIME_LIMITS[field]]),
);

/**
 * Accepts untrusted values (database rows, a worker message): a positive safe
 * integer is kept up to its ceiling; anything else falls back to the constant.
 */
export function sanitizeRuntimeLimits(raw: unknown): RuntimeLimits {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = (field: keyof RuntimeLimits) => {
    const value = source[field];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? Math.min(value, DEFAULT_RUNTIME_LIMITS[field])
      : DEFAULT_RUNTIME_LIMITS[field];
  };
  const limits = Object.fromEntries(FIELDS.map((field) => [field, pick(field)])) as unknown as RuntimeLimits;
  // The cache must hold at least one full-size page or no preview could be kept.
  return { ...limits, pdfPreviewCachePixels: Math.max(limits.pdfPreviewCachePixels, limits.pdfPreviewMaxPixels) };
}

/** Maps `system_limits` rows (key → value) to the effective limits. */
export function runtimeLimitsFromRows(rows: Readonly<Record<string, number>>): RuntimeLimits {
  return sanitizeRuntimeLimits(Object.fromEntries(FIELDS.map((field) => [field, rows[RUNTIME_LIMIT_KEYS[field]]])));
}

let current: RuntimeLimits = DEFAULT_RUNTIME_LIMITS;

/** Read at call time, never cached by consumers, so a new page or job picks up edits. */
export const getRuntimeLimits = (): RuntimeLimits => current;

/**
 * Installs the limits for this JS realm (page or tool worker). The server
 * resolves them per request and sends them with the page and each worker job.
 */
export function setRuntimeLimits(limits: unknown): void {
  current = sanitizeRuntimeLimits(limits);
}
