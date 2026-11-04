/**
 * Settings sub-pages in sidebar order, and how each page groups its fields.
 * Only settings an admin can change live are listed; env-only config is not shown.
 */
export const SETTINGS_SECTIONS = [
  {
    slug: "limits",
    label: "Tool limits",
    description:
      "Caps for every tool. A tool asking for more is capped to these values, and saving a definition above them is rejected. Values cannot go past the maximum built into the code.",
    groups: [
      {
        title: "Files and text",
        description: "How much a visitor can load into any tool.",
        keys: ["platform_max_bytes", "blob_fallback_max_bytes", "max_editable_text_chars", "large_text_preview_bytes"],
      },
      {
        title: "CSV preview",
        description: "How much of a CSV file is parsed for the on-page preview.",
        keys: ["csv_preview_rows", "csv_preview_bytes", "csv_max_field_bytes", "csv_max_row_bytes"],
      },
      {
        title: "PDF preview",
        description: "Rendering size and memory for PDF page previews.",
        keys: [
          "pdf_preview_max_width",
          "pdf_preview_max_pixels",
          "pdf_preview_cache_pixels",
          "pdf_thumbnail_cache_size",
        ],
      },
    ],
  },
  {
    slug: "ai",
    label: "AI",
    description: "AI assistant switch and models. The API key stays on the server.",
    groups: [
      { title: "Assistant", description: "Blog and tool admin assistant.", keys: ["ai.enabled"] },
      { title: "Models", description: "Which OpenAI model does each job.", keys: ["ai.openaiModel", "ai.titleModel"] },
    ],
  },
  {
    slug: "traffic",
    label: "Rate limits",
    description: "Per-visitor request caps for server-side tools. Lower them during abuse; counts reset each minute.",
    groups: [
      {
        title: "Per visitor",
        description: "Counted separately for each visitor.",
        keys: ["traffic.toolRequestsPerMinute", "traffic.codeRunsPerMinute"],
      },
    ],
  },
  {
    slug: "site",
    label: "Site",
    description: "Details shown to visitors.",
    groups: [{ title: "Contact", description: "Shown on the Contact page.", keys: ["site.supportEmail"] }],
  },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];

const LIMIT_LABELS: Record<string, string> = {
  platform_max_bytes: "Largest file",
  blob_fallback_max_bytes: "Largest in-memory file",
  max_editable_text_chars: "Longest editable text",
  large_text_preview_bytes: "Text preview size",
  csv_preview_rows: "Preview rows",
  csv_preview_bytes: "Preview size",
  csv_max_field_bytes: "Largest field",
  csv_max_row_bytes: "Largest row",
  pdf_preview_max_width: "Preview width",
  pdf_preview_max_pixels: "Pixels per page",
  pdf_preview_cache_pixels: "Preview cache",
  pdf_thumbnail_cache_size: "Cached thumbnails",
};

/** Readable name for a `system_limits` key; unknown keys fall back to their words. */
export function limitLabel(key: string): string {
  if (LIMIT_LABELS[key]) return LIMIT_LABELS[key];
  const words = key.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
