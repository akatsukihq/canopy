/**
 * Keep the message, remove stack frames, and mask credentials. SQL text and
 * parameters are masked too unless `showSql` is set (server logs only).
 */
export function errorMessage(error: unknown, fallback: string, { showSql = false } = {}): string {
  const value =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? error.message
        : undefined;
  if (typeof value !== "string") return fallback;

  const message = value.split(/\r?\n\s*at\s/)[0].trim();
  if (!message) return fallback;
  const sqlMasked = showSql
    ? message
    : message
        .replace(/\b(Failed query:)[\s\S]*?(?=\r?\nparams:|$)/gi, "$1 [hidden]")
        .replace(/\b(params:)[\s\S]*/gi, "$1 [hidden]");
  return sqlMasked
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|cloudinary):\/\/[^\s"'<>]+/gi, "[hidden]")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s/]*@[^\s"'<>]+/gi, "[hidden]")
    .replace(/\b((?:Bearer|Basic)\s+)[^\s,;"'<>]+/gi, "$1[hidden]")
    .replace(
      /(\b(?:password|passwd|secret|token|api[_-]?(?:key|secret)|(?:access|refresh)[_-]?token|client[_-]?secret|authorization)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+\[hidden\]|[^\s,;&}]+)/gi,
      "$1[hidden]",
    );
}
