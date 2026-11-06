/** Server-only glue between an assistant section and its admin-configured agents. */
import "server-only";
import type { AssistantStageRequest, StoredRun } from "../assistant/integration.ts";
import { AssistantError } from "../assistant/validation.ts";
import { compileAgent, type CompileInput } from "./compile.ts";
import { AgentConfigError, getSectionAgent, loadAgentRuntime } from "./store.ts";
import type { Agent, AgentSection } from "./types.ts";

export const NO_SECTION_AGENT =
  "No AI agent is set up for this section. Ask an admin to enable one in Admin → AI agents.";

function configError(error: unknown): unknown {
  return error instanceof AgentConfigError ? new AssistantError("AGENT_CONFIG", error.message) : error;
}

/** The enabled agent the request names (id, key or command), or the section default. */
export async function sectionAgent(section: AgentSection, idOrCommand?: string): Promise<Agent> {
  let agent: Agent | null;
  try {
    agent = await getSectionAgent(section, idOrCommand);
  } catch (error) {
    throw configError(error);
  }
  if (agent) return agent;
  throw new AssistantError(
    "AGENT_UNAVAILABLE",
    idOrCommand && (await getSectionAgent(section))
      ? "This agent is turned off or no longer available. Choose another agent."
      : NO_SECTION_AGENT,
  );
}

type SectionInput = Omit<CompileInput, "provider" | "actorUserId" | "model" | "metadata">;

/**
 * Compiles a section agent for a run. A model or effort the user picked applies to every agent in the
 * graph; otherwise each agent's own setting (or the run's default model) is used.
 */
export async function compileSectionAgent(
  agent: Agent,
  run: StoredRun,
  input: SectionInput,
): Promise<AssistantStageRequest> {
  try {
    const runtime = await loadAgentRuntime(agent.id);
    const { model, effort } = run.request;
    const agents =
      model || effort
        ? Object.fromEntries(
            Object.entries(runtime.agents).map(([id, entry]) => [
              id,
              { ...entry, ...(model ? { model: null } : {}), ...(effort ? { effort } : {}) },
            ]),
          )
        : runtime.agents;
    return await compileAgent(
      { ...runtime, agent: agents[runtime.agent.id], agents },
      {
        ...input,
        provider: run.provider,
        actorUserId: run.ownerId,
        model: run.model,
        metadata: { runId: run.id, agentId: agent.key },
      },
    );
  } catch (error) {
    throw configError(error);
  }
}
