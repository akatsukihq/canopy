/** Server-only agent chain for "turn my idea into a blog": Planner → Writer → Stop-slop editor → Media. */
import "server-only";
import type { AIMessage } from "../ai/types.ts";
import type { AssistantStageRequest } from "../assistant/integration.ts";
import { ANTI_SLOP, lines, NO_RESEARCH, RESEARCH, SAFETY, STRATEGIST, WRITER_CRAFT } from "./agentPersonas.ts";
import { generationSchema } from "./assistantValidation.ts";
import { mediaStage } from "./generationMedia.ts";

const PLANNER = lines(
  STRATEGIST,
  "",
  "## Output: the brief",
  "Plain text in the requested language, in this order: search intent, page format and audience; reader stories; content gaps and the unique angle (information gain); primary and secondary keywords with placement; title options with draft seoTitle and meta description; the direct answer; Key Takeaways; the winning outline (per section: heading, point, coverage, proof, format, keyword guidance, approximate words, snippet targets); the evidence list; E-E-A-T needs; FAQ or 'none'; the conclusion and next step; the target length.",
  "",
  SAFETY,
);

const WRITER = lines(
  WRITER_CRAFT,
  "",
  "## Inputs",
  "Follow the planner's approved brief: template, angle, section plan, evidence list and keywords. Respect the requested language, tone, length, audience and keyword. If the brief and the evidence disagree, the evidence wins. Cite only sources in the brief's evidence list or the planner's source list. Block text is literal text, so write the source name, never a URL or Markdown link.",
  "- keywords: the primary keyword first, then the secondary terms the article covers.",
  "",
  "## Self-check before returning",
  "- Key Takeaways list present right after the introduction; heading levels clean.",
  "- Every statistic has a named source from the brief; nothing invented; conclusions match their supporting facts.",
  "- No em dashes, no meta commentary about the article; SEO fields within limits and consistent with the body.",
  "Return the required structured output. Block text is literal text, never HTML or Markdown.",
  "",
  SAFETY,
);

const STOP_SLOP = lines(
  "You are the final line editor. Remove predictable AI writing patterns from this article. Keep its facts, sources, numbers, heading order and levels, list structure, Key Takeaways, FAQ, language and meaning unchanged. Rewrite sentences; do not add claims or sections.",
  "",
  ANTI_SLOP,
  "",
  "Keep SEO fields within limits (seoTitle about 50-60 characters, seoDescription about 130-155) and the keywords list as given. Return the complete article in the same structured output; block text is literal text.",
  "",
  SAFETY,
);

export type GenerationOptions = {
  webSearch: boolean;
  /** Set when the media agent should plan, generate and store images for the article. */
  media?: { actorUserId: string; provider: string };
};

/** Builds the chained requests from the shared generate context (system message first, user context last). */
export function generationStages(base: AIMessage[], { webSearch, media }: GenerationOptions): AssistantStageRequest {
  const context = base.slice(1);
  const rules = typeof base[0]?.content === "string" ? base[0].content : "";
  return {
    stage: webSearch ? "Researching and planning the article" : "Planning the article",
    // Only the planner searches; later agents work from its brief and the sources it actually read.
    webSearch,
    messages: [
      {
        role: "system",
        content: `${PLANNER}\n\n${webSearch ? RESEARCH : NO_RESEARCH}`,
      },
      ...context,
    ],
    next: (plan) => ({
      stage: "Writing the complete article",
      schema: generationSchema,
      messages: [
        { role: "system", content: `${WRITER}\n\n${rules}` },
        ...context,
        {
          role: "user",
          content: `Approved brief from the planner:\n${plan.text}${
            plan.citations.length
              ? `\n\nSources the planner actually read (cite only these):\n${plan.citations.map((c) => `- ${c.title}: ${c.url}`).join("\n")}`
              : ""
          }`,
        },
      ],
      next: (draft) => {
        const article = generationSchema.safeParse(draft.output);
        if (!article.success) return undefined; // The writer's own result is validated and reported as-is.
        return {
          stage: "Removing AI writing patterns",
          schema: generationSchema,
          messages: [
            { role: "system", content: STOP_SLOP },
            ...context,
            { role: "user", content: `Article to edit:\n${JSON.stringify(article.data)}` },
          ],
          next: (edited) => {
            const final = generationSchema.safeParse(edited.output);
            return media && final.success ? mediaStage(final.data, media.actorUserId, media.provider) : undefined;
          },
        };
      },
    }),
  };
}
