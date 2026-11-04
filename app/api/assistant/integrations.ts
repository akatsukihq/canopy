import { createAssistantService } from "@/lib/assistant/service.ts";
import { AssistantError } from "@/lib/assistant/validation.ts";
import { toolTranslationAssistantIntegration } from "@/lib/tool-framework/translationAssistant.ts";
import { blogAssistantIntegration } from "@/lib/blog/assistantIntegration.ts";

// Feature registration belongs at the application boundary, never in Assistant core.
const services = new Map([
  ["blog", createAssistantService(blogAssistantIntegration)],
  ["tool-translations", createAssistantService(toolTranslationAssistantIntegration)],
]);

export function getAssistantService(integrationKey: string) {
  const service = services.get(integrationKey);
  if (!service) throw new AssistantError("NOT_FOUND", "Assistant integration not found.", 404);
  return service;
}
