import config from "@/lib/config/config.ts";
import { handleAssistantMaintenanceRequest } from "@/lib/assistant/cron.ts";
import { captureException } from "@sentry/core";
import { logError } from "@/lib/observability/logger.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAssistantMaintenanceRequest(request, config.schedulerSecret, async () => {
    try {
      const { cleanupAssistant } = await import("@/lib/assistant/maintenance.ts");
      return await cleanupAssistant();
    } catch (error) {
      captureException(error);
      logError("cron.assistant_maintenance.failed", error);
      throw error;
    }
  });
}
