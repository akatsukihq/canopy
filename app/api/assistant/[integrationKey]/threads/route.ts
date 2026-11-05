import { assistantRoute, readAssistantJson } from "@/lib/assistant/http.ts";
import { assistantResourceId } from "@/lib/assistant/validation.ts";
import { getAssistantService } from "../../integrations.ts";

type Context = { params: Promise<{ integrationKey: string }> };
function resourceScope(request: Request) {
  const resourceId = new URL(request.url).searchParams.get("resourceId");
  return resourceId === null ? null : assistantResourceId.parse(resourceId);
}
export async function GET(request: Request, { params }: Context) {
  return assistantRoute(request, async (actor) => ({
    threads: await getAssistantService((await params).integrationKey).listThreads(actor, resourceScope(request)),
  }));
}
export async function POST(request: Request, { params }: Context) {
  return assistantRoute(request, async (actor) => ({
    thread: await getAssistantService((await params).integrationKey).createThread(
      actor,
      resourceScope(request),
      await readAssistantJson(request),
    ),
  }));
}
