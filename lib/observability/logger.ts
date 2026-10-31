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

export function logError(event: string, error: unknown, fields: Fields = {}): void {
  log("error", event, {
    ...fields,
    error: {
      name: error instanceof Error ? error.name : typeof error,
      message: errorMessage(error, "Unknown error"),
      stack: frames(error),
    },
  });
}
