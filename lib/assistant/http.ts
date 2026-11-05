import { z } from "zod";
import { getSession, AuthServiceError } from "../auth/session.ts";
import { AuthorizationError } from "../admin/index.ts";
import { AIError } from "../ai/errors.ts";
import { isSameOriginRequest } from "../routing/requestOrigin.ts";
import { AssistantError } from "./validation.ts";
import { log } from "../observability/logger.ts";

const headers = { "Cache-Control": "private, no-store" };
export async function readAssistantJson(request: Request): Promise<unknown> {
  const text = await boundedRequestText(request, 2 * 1024 * 1024);
  try {
    return JSON.parse(text);
  } catch {
    throw new AssistantError("VALIDATION", "Send a valid JSON request.");
  }
}
export async function boundedRequestText(request: Request, maximum: number): Promise<string> {
  return (await boundedRequestBytes(request, maximum)).toString("utf8");
}
export async function readAssistantUpload(request: Request): Promise<FormData> {
  const bytes = await boundedRequestBytes(request, 6 * 1024 * 1024);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
async function boundedRequestBytes(request: Request, maximum: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > maximum)
    throw new AssistantError("VALIDATION", "Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new AssistantError("VALIDATION", "Request is too large.", 413);
      }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}
export function assistantErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(({ code, path, message }) => ({ code, path: path.join("."), message }));
    log("warn", "assistant.validation", { issues });
    return Response.json(
      {
        code: "VALIDATION",
        error: "Check the request fields and supported input lengths.",
        ...(process.env.NODE_ENV === "development" ? { issues } : {}),
      },
      { status: 400, headers },
    );
  }
  if (error instanceof AssistantError || error instanceof AIError)
    return Response.json({ code: error.code, error: error.message }, { status: error.status, headers });
  if (error instanceof AuthorizationError)
    return Response.json(
      { code: "FORBIDDEN", error: "You do not have permission for this operation." },
      { status: 403, headers },
    );
  if (error instanceof AuthServiceError)
    return Response.json(
      { code: "UNAVAILABLE", error: "Authentication is temporarily unavailable." },
      { status: 503, headers },
    );
  return Response.json(
    { code: "UNAVAILABLE", error: "The request could not be completed. Try again shortly." },
    { status: 503, headers },
  );
}
export async function assistantRoute(request: Request, action: (actor: string) => Promise<unknown>): Promise<Response> {
  try {
    if (!["GET", "HEAD"].includes(request.method) && !isSameOriginRequest(request))
      throw new AssistantError("FORBIDDEN", "Invalid request origin.", 403);
    const session = await getSession(request.headers, { includeAdmin: false });
    if (!session) throw new AssistantError("UNAUTHENTICATED", "Sign in to continue.", 401);
    if (session.user.status !== "active")
      throw new AssistantError("FORBIDDEN", "This account cannot use the assistant.", 403);
    const result = await action(session.user.id);
    return result instanceof Response ? result : Response.json(result, { headers });
  } catch (error) {
    return assistantErrorResponse(error);
  }
}
