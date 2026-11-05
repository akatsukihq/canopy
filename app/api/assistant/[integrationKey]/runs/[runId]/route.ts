import { assistantRoute } from "@/lib/assistant/http.ts";
import { getAssistantService } from "../../../integrations.ts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ integrationKey: string; runId: string }> },
) {
  return assistantRoute(request, async (actor) => {
    const { integrationKey, runId } = await params;
    return { run: await getAssistantService(integrationKey).getRun(actor, runId) };
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ integrationKey: string; runId: string }> },
) {
  return assistantRoute(request, async (actor) => {
    const { integrationKey, runId } = await params;
    return { run: await getAssistantService(integrationKey).cancelRun(actor, runId) };
  });
}
