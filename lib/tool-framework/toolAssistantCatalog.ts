/** Tool admin assistant fields shared by the browser panel and the server (no server-only imports). */

/** Content fields a suggestion may target, and the admin section whose form owns each. */
export const CONTENT_FIELD_SECTION = {
  category: "overview",
  keywords: "overview",
  seoTitle: "overview",
  seoDescription: "overview",
  howToUse: "content",
  limitations: "content",
  faq: "content",
  examples: "content",
  relatedToolIds: "content",
} as const;
export type ToolContentField = keyof typeof CONTENT_FIELD_SECTION;
