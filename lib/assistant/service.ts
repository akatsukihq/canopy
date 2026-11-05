import { assistantModels } from "../config/integrations.ts";
import { createAssistantThreads } from "./threads.ts";
import { createAssistantRuns } from "./runs.ts";
import type { AssistantIntegration } from "./integration.ts";

export function createAssistantService(integration: AssistantIntegration) {
  const threads = createAssistantThreads(integration);
  const runs = createAssistantRuns(integration, threads);
  return {
    ...threads,
    ...runs,
    async config(actor: string) {
      await integration.authorizeConfiguration(actor);
      const availability = await threads.assistantAvailability();
      if (!availability.enabled) return availability;
      const { defaultModel, models } = await assistantModels();
      return { ...availability, defaultModel, models };
    },
  };
}
