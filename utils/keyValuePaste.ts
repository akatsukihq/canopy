export type PastedPair = { key: string; value: string };

const unquote = (text: string): string => {
  const trimmed = text.trim();
  const quote = trimmed[0];
  if (trimmed.length < 2 || (quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  const inner = trimmed.slice(1, -1);
  if (quote === '"') {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return inner;
    }
  }
  return inner;
};

/** Index of the first `:` or `=` outside quotes, or -1. */
function separatorIndex(line: string): number {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ":" || char === "=") return i;
  }
  return -1;
}

/**
 * Reads pasted text as one key/value pair per line: `"key": "value",`, `key: value`, `KEY=value`, or a whole
 * JSON object. A trailing comma and lone brace lines are ignored; `#` and `//` lines are skipped. Returns null
 * when the text does not look like pairs, so callers keep the browser's normal paste.
 */
export function parseKeyValuePaste(text: string): PastedPair[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : JSON.stringify(value),
        }));
      }
    } catch {
      // Fall through to line parsing for templates like {{...}} values or trailing commas.
    }
  }
  const pairs: PastedPair[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.trim().replace(/,$/, "").trim();
    if (!line || line === "{" || line === "}" || line.startsWith("#") || line.startsWith("//")) continue;
    const at = separatorIndex(line);
    if (at < 1) return null;
    const key = unquote(line.slice(0, at));
    if (!key) return null;
    pairs.push({ key, value: unquote(line.slice(at + 1)) });
  }
  return pairs.length ? pairs : null;
}

/**
 * Pairs to paste into a row. A name field accepts a single pair line (names cannot hold `:` or `=`); a value
 * field only takes multi-line pastes so a pasted URL or time stays intact.
 */
export function pairsFromPaste(text: string, field: "key" | "value"): PastedPair[] | null {
  const pairs = parseKeyValuePaste(text);
  if (!pairs) return null;
  return field === "value" && pairs.length < 2 ? null : pairs;
}

/** Puts pasted pairs at `index`: replaces that row when it is empty, otherwise inserts after it. */
export function insertPairs<T extends { key: string; value: string }>(
  rows: readonly T[],
  index: number,
  pasted: readonly PastedPair[],
  make: (pair: PastedPair) => T,
): T[] {
  const blank = !rows[index]?.key && !rows[index]?.value;
  const at = blank ? index : index + 1;
  return [...rows.slice(0, at), ...pasted.map(make), ...rows.slice(blank ? index + 1 : at)];
}
