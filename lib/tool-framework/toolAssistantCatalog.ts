/** Tool admin assistant catalog shared by the browser panel and the server (no server-only imports). */

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

/** Public agent metadata; each agent's prompt stays on the server in toolAssistant.ts. */
export const TOOL_AGENTS = [
  {
    id: "seo",
    effort: "high",
    name: "SEO writer",
    command: "/seo",
    description: "Titles, descriptions and keywords.",
    aliases: ["seo", "title", "keywords"],
  },
  {
    id: "content",
    effort: "medium",
    name: "Content writer",
    command: "/content",
    description: "How to use, FAQs, examples and limits.",
    aliases: ["content", "faq", "examples", "writer"],
  },
  {
    id: "translator",
    effort: "medium",
    name: "Translator",
    command: "/translate",
    description: "Translate or review this language.",
    aliases: ["translate", "translator", "language"],
  },
  {
    id: "definition",
    effort: "high",
    name: "Definition reviewer",
    command: "/definition",
    description: "Explain or check the tool's spec.",
    aliases: ["definition", "spec", "review"],
  },
] as const;

export type ToolAgentId = (typeof TOOL_AGENTS)[number]["id"];
