/**
 * Category registry for the tool framework.
 *
 * This module is the root of the framework dependency graph: it imports
 * nothing. `spec.ts` depends on it, never the other way around.
 *
 * Labels and descriptions are copied verbatim from the category lists that the
 * catalogue pages render today, so a category rename stays a one-line change.
 */

export type ToolApp = "devtools" | "media";

export type ToolCategory = {
  readonly label: string;
  readonly description: string;
  readonly app: ToolApp;
};

export const TOOL_CATEGORIES = {
  "json-tools": {
    label: "JSON Tools",
    description: "Format, validate, compare, and transform JSON.",
    app: "devtools",
  },
  "csv-data-tools": {
    label: "CSV & Data Tools",
    description: "Convert, inspect, and clean tabular data.",
    app: "devtools",
  },
  "text-tools": {
    label: "Text Tools",
    description: "Count, compare, sort, and reshape text.",
    app: "devtools",
  },
  "encoding-decoding": {
    label: "Encoding & Decoding",
    description: "Work with Base64, URLs, HTML, and binary data.",
    app: "devtools",
  },
  "hashing-crypto": {
    label: "Hashing & Crypto",
    description: "Generate hashes and inspect common security formats.",
    app: "devtools",
  },
  "jwt-api-tools": {
    label: "JWT & API Tools",
    description: "Decode tokens and prepare API requests.",
    app: "devtools",
  },
  "web-markup-tools": {
    label: "Web & Markup Tools",
    description: "Convert and inspect developer-facing markup.",
    app: "devtools",
  },
  "color-design-tools": {
    label: "Color & Design Tools",
    description: "Convert, inspect, and generate color values.",
    app: "devtools",
  },
  "date-time-tools": {
    label: "Date & Time Tools",
    description: "Convert timestamps and compare dates.",
    app: "devtools",
  },
  "developer-generators": {
    label: "Developer Generators",
    description: "Create IDs, passwords, mock data, and more.",
    app: "devtools",
  },
  compilers: {
    label: "Compilers",
    description: "Write, run, and test code online in many languages.",
    app: "devtools",
  },
  "diagram-tools": {
    label: "Diagram Tools",
    description: "Turn structured text into useful diagrams.",
    app: "devtools",
  },
  "seo-domain-tools": {
    label: "SEO & Domain Tools",
    description: "Inspect domains, DNS, and search metadata.",
    app: "devtools",
  },
  "pdf-conversion": {
    label: "PDF Conversion",
    description: "Move between images and PDF pages without uploading files.",
    app: "media",
  },
  "pdf-organization": {
    label: "PDF Organization",
    description: "Merge, split, reorder, rotate, crop, and resize PDF pages.",
    app: "media",
  },
  "pdf-optimization": {
    label: "PDF Optimization",
    description: "Compress, watermark, and number documents locally.",
    app: "media",
  },
  "image-conversion": {
    label: "Image Conversion",
    description: "Convert JPG, PNG, WebP, and HEIC images in your browser.",
    app: "media",
  },
  "image-editing": {
    label: "Image Editing",
    description: "Resize, crop, rotate, combine, and optimize images.",
    app: "media",
  },
} as const satisfies Record<string, ToolCategory>;

export type CategoryKey = keyof typeof TOOL_CATEGORIES;

export const CATEGORY_KEYS: readonly CategoryKey[] = Object.keys(TOOL_CATEGORIES) as readonly CategoryKey[];

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && Object.hasOwn(TOOL_CATEGORIES, value);
}

export function categoriesForApp(app: ToolApp): readonly CategoryKey[] {
  return CATEGORY_KEYS.filter((key) => TOOL_CATEGORIES[key].app === app);
}

/** Accept display-name URLs emitted by older navigation while keeping stable keys internally. */
export function resolveCategoryKey(value: string, app: ToolApp): CategoryKey | "" {
  const normalized = value.trim().toLowerCase();
  return (
    categoriesForApp(app).find(
      (key) => key === normalized || TOOL_CATEGORIES[key].label.toLowerCase() === normalized,
    ) ?? ""
  );
}

/**
 * Replaces the two hard-coded key lists the catalogue pages use today.
 *
 * Deliberately empty: a featured ordering is per-deployment *data*, and the
 * framework's central invariant is that no individual tool is named inside it
 * (same reasoning as icons). Populate this from the control plane / admin at
 * the edge where tool identity is allowed.
 */
export const FEATURED_TOOL_IDS: readonly string[] = [];
