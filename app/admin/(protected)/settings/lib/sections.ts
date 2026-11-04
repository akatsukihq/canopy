/** Settings sub-pages, in sidebar order. Shared by the sidebar and the section route. */
export const SETTINGS_SECTIONS = [
  {
    slug: "limits",
    label: "Tool limits",
    description:
      "Caps every tool's file sizes and text length. A tool asking for more is capped to these values, and saving a definition above them is rejected. Values cannot go past the maximum built into the code.",
  },
  { slug: "ai", label: "AI", description: "AI assistant switch and models. The API key stays in the environment." },
  {
    slug: "traffic",
    label: "Rate limits",
    description: "Per-visitor request caps for server-side tools. Lower them during abuse; they reset each minute.",
  },
  { slug: "site", label: "Site", description: "Details shown to visitors." },
  {
    slug: "environment",
    label: "Environment",
    description:
      "View only. Set as server environment variables; changes need a restart or redeploy. Secret values are never shown.",
  },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];
