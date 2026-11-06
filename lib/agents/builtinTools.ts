/** Server-only registry of code-implemented tools an agent may be granted. */
import "server-only";
import { z } from "zod";
import type { AITool } from "../ai/types.ts";
import { generateArticleImage } from "../blog/generationMedia.ts";
import type { BuiltinTool } from "./types.ts";

export type BuiltinToolContext = {
  actorUserId: string;
  provider: string;
  reportToolFailure: (toolName: string, error: unknown) => void;
};

const imageInput = z
  .object({
    prompt: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "Self-contained narrative brief: subject, action, setting, composition, lighting, one style. No text, logos or real people.",
      ),
    alt: z.string().min(1).max(200).describe("10-125 character sentence naming what the image shows."),
    caption: z.string().max(300).describe("One short sentence, or ''."),
  })
  .strict();

const REGISTRY: Record<BuiltinTool, (context: BuiltinToolContext) => AITool> = {
  generate_image: ({ actorUserId, provider, reportToolFailure }) => ({
    description:
      "Generate an AI image and store it. Returns the stored image (src, alt, caption) to reference in your answer.",
    inputSchema: imageInput,
    execute: async (input, { signal }) => {
      try {
        const image = await generateArticleImage(actorUserId, provider, imageInput.parse(input), signal);
        return { status: "generated", image };
      } catch (error) {
        reportToolFailure("generate_image", error);
        return { status: "failed", error: "Image generation failed. Continue without this image." };
      }
    },
  }),
};

/** The granted builtin tools, keyed by their model-facing name. */
export function builtinTools(names: readonly BuiltinTool[], context: BuiltinToolContext): Record<string, AITool> {
  return Object.fromEntries(names.map((name) => [name, REGISTRY[name](context)]));
}
