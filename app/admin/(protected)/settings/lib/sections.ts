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
    description:
      "Save each provider's key and models, then make one active. Keys are encrypted and never shown again after saving.",
    groups: [
      { title: "Assistant", description: "Blog and tool admin assistant.", keys: ["ai.enabled"] },
      {
        title: "OpenAI",
        description: "Load models lists what the key can use; Test checks the key.",
        keys: ["ai.openai.apiKey", "ai.openaiModel", "ai.titleModel"],
        provider: { setting: "ai.provider", value: "openai" },
        test: "ai",
      },
      {
        title: "Anthropic",
        description: "Load models lists what the key can use; Test checks the key.",
        keys: ["ai.anthropic.apiKey", "ai.anthropicModel", "ai.anthropicTitleModel"],
        provider: { setting: "ai.provider", value: "anthropic" },
        test: "ai",
      },
    ],
  },
  {
    slug: "email",
    label: "Email",
    description:
      "Save each provider's credentials, send a test, then make one active. Sign-in emails go through the active provider.",
    groups: [
      {
        title: "Addresses",
        description: "Used by every provider.",
        keys: ["email.accountsFrom", "site.supportEmail"],
      },
      {
        title: "Cloudflare",
        description: "Cloudflare Email Sending.",
        keys: ["email.cloudflare.accountId", "email.cloudflare.apiToken"],
        provider: { setting: "email.provider", value: "cloudflare" },
        test: "email",
      },
      {
        title: "Resend",
        description: "resend.com API.",
        keys: ["email.resend.apiKey"],
        provider: { setting: "email.provider", value: "resend" },
        test: "email",
      },
      {
        title: "SMTP",
        description: "Any SMTP server, such as Google Workspace, SES or Postmark.",
        keys: ["email.smtp.host", "email.smtp.port", "email.smtp.secure", "email.smtp.user", "email.smtp.password"],
        provider: { setting: "email.provider", value: "smtp" },
        test: "email",
      },
    ],
  },
  {
    slug: "uploads",
    label: "Uploads",
    description: "Image hosting for blog images and tool icons.",
    groups: [
      {
        title: "Cloudinary",
        description: "Rotate the API key and secret here. The cloud name is fixed by the environment.",
        keys: ["uploads.cloudinary.apiKey", "uploads.cloudinary.apiSecret"],
      },
    ],
  },
  {
    slug: "integrations",
    label: "Integrations",
    description: "Third-party APIs used by individual tools.",
    groups: [{ title: "Ahrefs", description: "Domain Rating Checker.", keys: ["integrations.ahrefs.apiKey"] }],
  },
  {
    slug: "traffic",
    label: "Rate limits",
    description: "Per-visitor request caps for server-side tools. Lower them during abuse; counts reset each minute.",
    groups: [
      {
        title: "Per visitor",
        keys: ["traffic.toolRequestsPerMinute", "traffic.codeRunsPerMinute"],
      },
    ],
  },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];

/** A group whose provider can be made active, and how it is tested. */
export type GroupProvider = { setting: "ai.provider" | "email.provider"; value: string };
export type GroupTest = "ai" | "email";

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
