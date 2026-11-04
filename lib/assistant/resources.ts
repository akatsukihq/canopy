import { z } from "zod";
import { createAIClient } from "../config/integrations.ts";
import type { StoredRun } from "./integration.ts";

export function attachmentProvider(data: Record<string, unknown>): { name: string; fileId: string } | null {
  const value = z.object({ name: z.string().min(1), fileId: z.string().min(1) }).safeParse(data.provider);
  return value.success ? value.data : null;
}
export async function deleteRunResponses(run: StoredRun) {
  if (run.continuation.providerDeleted === true) return;
  const handles = z.array(z.string()).catch([]).parse(run.continuation.handles);
  for (const id of new Set([...handles, ...(run.providerResponseId ? [run.providerResponseId] : [])]))
    await (await createAIClient(run.provider)).deleteResponse(id);
}
