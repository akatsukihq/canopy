import { afterEach, expect, test } from "vitest";

import {
  DEFAULT_RUNTIME_LIMITS,
  getRuntimeLimits,
  runtimeLimitsFromRows,
  setRuntimeLimits,
} from "../lib/tool-framework/limits.ts";
import { DATABASE_SYSTEM_LIMITS, clampSpecLimits, limitViolations } from "../lib/tool-framework/systemLimits.ts";
import { toolsOverLimits } from "../app/admin/(protected)/settings/lib/overLimitTools.ts";

afterEach(() => setRuntimeLimits(undefined));

const spec = (input) => ({
  toolId: "devtools.sample-tool",
  app: "devtools",
  category: "json-tools",
  keywords: [],
  name: "Sample",
  description: "Sample tool.",
  input,
  settings: { fields: {} },
  trigger: { mode: "live" },
  labels: { empty: "Empty", ready: "Ready", running: "Running" },
  content: { howToUse: ["Paste."] },
});

test("no database rows resolve to the code constants", () => {
  expect(runtimeLimitsFromRows({})).toEqual(DEFAULT_RUNTIME_LIMITS);
});

test("a stored value lower than the constant is used", () => {
  const limits = runtimeLimitsFromRows({ csv_preview_rows: 50, platform_max_bytes: 1024 });
  expect(limits.csvPreviewRows).toBe(50);
  expect(limits.platformMaxBytes).toBe(1024);
  expect(limits.csvPreviewBytes).toBe(DEFAULT_RUNTIME_LIMITS.csvPreviewBytes);
});

test("a stored value above the ceiling is capped; invalid values fall back", () => {
  const limits = runtimeLimitsFromRows({
    csv_preview_rows: 10 ** 9,
    pdf_preview_max_width: 0,
    csv_max_row_bytes: -5,
    large_text_preview_bytes: 1.5,
    csv_max_field_bytes: Number.NaN,
  });
  expect(limits.csvPreviewRows).toBe(DEFAULT_RUNTIME_LIMITS.csvPreviewRows);
  expect(limits.pdfPreviewMaxWidth).toBe(DEFAULT_RUNTIME_LIMITS.pdfPreviewMaxWidth);
  expect(limits.csvMaxRowBytes).toBe(DEFAULT_RUNTIME_LIMITS.csvMaxRowBytes);
  expect(limits.largeTextPreviewBytes).toBe(DEFAULT_RUNTIME_LIMITS.largeTextPreviewBytes);
  expect(limits.csvMaxFieldBytes).toBe(DEFAULT_RUNTIME_LIMITS.csvMaxFieldBytes);
});

test("the PDF cache can always hold one full-size page", () => {
  const limits = runtimeLimitsFromRows({ pdf_preview_cache_pixels: 10, pdf_preview_max_pixels: 4_000_000 });
  expect(limits.pdfPreviewCachePixels).toBe(4_000_000);
});

test("setRuntimeLimits installs sanitized limits and undefined resets to defaults", () => {
  setRuntimeLimits({ ...DEFAULT_RUNTIME_LIMITS, csvPreviewRows: 7, csvPreviewBytes: "huge" });
  expect(getRuntimeLimits().csvPreviewRows).toBe(7);
  expect(getRuntimeLimits().csvPreviewBytes).toBe(DEFAULT_RUNTIME_LIMITS.csvPreviewBytes);
  setRuntimeLimits(undefined);
  expect(getRuntimeLimits()).toEqual(DEFAULT_RUNTIME_LIMITS);
});

test("every runtime limit is editable in Admin", () => {
  expect(DATABASE_SYSTEM_LIMITS).toHaveLength(12);
  expect(DATABASE_SYSTEM_LIMITS).toContain("csv_preview_rows");
});

test("a database value above the ceiling cannot raise a tool's cap", () => {
  const big = spec({ kind: "files", label: "Files", accept: ".pdf", maxBytes: 200 * 1024 * 1024 });
  const limits = { platform_max_bytes: 10 ** 12 };
  expect(clampSpecLimits(big, limits).input.maxBytes).toBe(DEFAULT_RUNTIME_LIMITS.platformMaxBytes);
  expect(limitViolations(big, limits)).toHaveLength(1);
});

test("Admin lists tools whose stored spec exceeds a lowered limit, by limit", () => {
  const rows = [
    { toolId: "devtools.a", name: "A", spec: spec({ kind: "text", label: "In", maxLength: 5000 }) },
    { toolId: "devtools.b", name: "B", spec: spec({ kind: "text", label: "In", maxLength: 100 }) },
    { toolId: "devtools.c", name: "C", spec: null },
    { toolId: "devtools.d", name: "D", spec: { broken: true } },
  ];
  const over = toolsOverLimits(rows, { max_editable_text_chars: 1000, platform_max_bytes: 1000 });
  expect(over).toEqual({
    max_editable_text_chars: [{ toolId: "devtools.a", name: "A", paths: ["input.maxLength"] }],
  });
  expect(toolsOverLimits(rows, {})).toEqual({});
});
