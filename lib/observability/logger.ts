import { errorMessage } from "../../utils/errorMessage.ts";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return value && value in RANK ? RANK[value as Level] : RANK.info;
}

/** One JSON object per line so Coolify/Docker log viewers and grep can filter by field. */
export function log(level: Level, event: string, fields: Fields = {}): void {
  if (RANK[level] < threshold()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

/**
 * Frames only: the first stack line repeats the message, which for Drizzle
 * embeds SQL and bound parameters. The message goes through errorMessage().
 */
function frames(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const lines = error.stack.split("\n").filter((line) => /^\s+at\s/.test(line));
  return lines.length ? lines.slice(0, 8).map((line) => line.trim()) : undefined;
}

/** Drizzle wraps the driver error ("Failed query: [hidden]"); the cause says why (code, relation, timeout). */
function cause(error: unknown): Fields | undefined {
  const inner = error instanceof Error ? error.cause : undefined;
  if (!inner) return undefined;
  const code = typeof inner === "object" && "code" in inner ? String(inner.code) : undefined;
  return {
    name: inner instanceof Error ? inner.name : typeof inner,
    code,
    message: errorMessage(inner, "Unknown cause", { showSql: true }),
  };
}

/** Masked, JSON-safe description of an error for logs and server-only diagnostic columns. */
export function errorDetails(error: unknown): Fields {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: errorMessage(error, "Unknown error", { showSql: true }),
    cause: cause(error),
    stack: frames(error),
  };
}

export function logError(event: string, error: unknown, fields: Fields = {}): void {
  log("error", event, { ...fields, error: errorDetails(error) });
}
