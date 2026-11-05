import { createHash, timingSafeEqual } from "node:crypto";
import { errorMessage } from "../../utils/errorMessage.ts";

type MaintenanceCounts = { files: number; runs: number; failed: number };

const TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;
const validSecret = (value: string | undefined): value is string =>
  Boolean(value && value.length <= 1024 && TOKEN_PATTERN.test(value));

function maintenanceCounts(value: unknown): MaintenanceCounts {
  if (!value || typeof value !== "object") throw new Error("Assistant maintenance returned an invalid response.");
  const result = value as Record<string, unknown>;
  for (const key of ["files", "runs", "failed"]) {
    if (!Number.isSafeInteger(result[key]) || (result[key] as number) < 0) {
      throw new Error("Assistant maintenance returned an invalid response.");
    }
  }
  return {
    files: result.files as number,
    runs: result.runs as number,
    failed: result.failed as number,
  };
}

export async function handleAssistantMaintenanceRequest(
  request: Request,
  secret: string | undefined,
  cleanup: () => Promise<MaintenanceCounts>,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { ...headers, Allow: "POST" } });
  }
  if (!validSecret(secret)) {
    return Response.json({ error: "Assistant maintenance is not configured." }, { status: 503, headers });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.length <= 1031 ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization)?.[1] : undefined;
  if (
    !token ||
    !timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(secret).digest())
  ) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    return Response.json(maintenanceCounts(await cleanup()), { headers });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Assistant maintenance is temporarily unavailable.") },
      { status: 503, headers },
    );
  }
}
