export const assistantApiBase = (integrationKey: string) => `/api/assistant/${encodeURIComponent(integrationKey)}`;
export const assistantCacheKey = (ownerId: string, integrationKey: string, resourceId?: string) =>
  `assistant:${JSON.stringify([ownerId, integrationKey, resourceId ?? null])}`;

export class AssistantRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function assistantRequest<T>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body instanceof FormData
      ? { body }
      : body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "The request could not complete. Your input is still here; try again.";
    throw new AssistantRequestError(message, response.status);
  }
  if (!result || typeof result !== "object") throw new Error("The server returned an unreadable response. Try again.");
  return result as T;
}

/** Leaving the page keeps a run going; this is the only way to stop one. */
export const cancelAssistantRun = (integrationKey: string, runId: string) =>
  assistantRequest(`${assistantApiBase(integrationKey)}/runs/${encodeURIComponent(runId)}`, undefined, "DELETE");

export const activeRun = (status: string) => ["queued", "running", "unknown"].includes(status);

/** One request owns one stream; callers own UI state and cancellation triggers. */
export async function streamAssistantRun(
  integrationKey: string,
  request: import("@/lib/assistant/types").AssistantRunRequest,
  signal: AbortSignal,
  onEvent: (event: import("@/lib/assistant/types").AssistantEvent) => void,
): Promise<import("@/lib/assistant/types").AssistantRun> {
  const response = await fetch(`${assistantApiBase(integrationKey)}/runs`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new AssistantRequestError(
      typeof result?.error === "string" ? result.error : "Could not start the request. Your input is still here.",
      response.status,
    );
  }
  if (!response.body) throw new Error("The server returned no stream. Refresh history before retrying.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: import("@/lib/assistant/types").AssistantRun | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    signal.throwIfAborted();
    const event = JSON.parse(line) as import("@/lib/assistant/types").AssistantEvent;
    if (
      !event ||
      !["run", "text", "text-delta", "reasoning-delta", "step", "proposal", "completed", "title", "error"].includes(
        event.type,
      )
    )
      throw new Error("The server sent an unreadable update. Refresh history before retrying.");
    if (
      (event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "text") &&
      typeof event.text !== "string"
    )
      throw new Error("Invalid text update.");
    if (
      (event.type === "run" || event.type === "completed") &&
      (!event.run || typeof event.run.id !== "string" || typeof event.run.status !== "string")
    )
      throw new Error("The server sent an invalid request update.");
    if (event.type === "title" && typeof event.title !== "string") throw new Error("Invalid title update.");
    if (event.type === "error" && typeof event.message !== "string")
      throw new Error("The server sent an invalid error update.");
    onEvent(event);
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "completed") completed = event.run;
  }
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!completed) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (completed) break;
      }
      if (done) {
        if (!completed && buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!completed)
      throw new Error("Connection interrupted. Refresh history to check the saved outcome before retrying.");
    return completed;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
