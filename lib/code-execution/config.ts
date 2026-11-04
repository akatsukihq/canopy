export type CodeExecutionConfig = {
  readonly url: string;
  readonly token: string;
  readonly maxConcurrent: number;
};

const DEFAULT_MAX_CONCURRENT = 8;
const MAX_CONCURRENT_CEILING = 256;

/**
 * Fails closed: returns null unless execution is explicitly enabled and every
 * value is present and valid. A set-but-invalid concurrency also disables it.
 */
export function readCodeExecutionConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CodeExecutionConfig | null {
  if (env.CODE_EXECUTION_ENABLED?.trim().toLowerCase() !== "true") return null;
  const token = env.PISTON_API_TOKEN?.trim();
  if (!token) return null;

  let url: URL;
  try {
    url = new URL(env.PISTON_URL?.trim() ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const rawConcurrent = env.CODE_EXECUTION_MAX_CONCURRENT?.trim();
  const maxConcurrent = rawConcurrent ? Number(rawConcurrent) : DEFAULT_MAX_CONCURRENT;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT_CEILING) return null;

  return { url: url.href.replace(/\/+$/, ""), token, maxConcurrent };
}
