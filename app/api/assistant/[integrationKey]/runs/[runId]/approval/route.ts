import { assistantRoute, readAssistantJson } from "@/lib/assistant/http.ts";
import { getAssistantService } from "../../../../integrations.ts";

/** Approves or rejects a run's paused tool calls and streams the continuation. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ integrationKey: string; runId: string }> },
) {
  return assistantRoute(request, async (actor) => {
    const { integrationKey, runId } = await params;
    return getAssistantService(integrationKey).respondToApproval(
      actor,
      runId,
      await readAssistantJson(request),
      request.signal,
    );
  });
}
