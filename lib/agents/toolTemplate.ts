/**
 * Request templating for custom HTTP tools. Placeholders are `{{args.<path>}}` (model arguments) and
 * `{{inputs.<id>}}` (the agent's inputs); nothing else is substituted. Pure: safe for client and server.
 */

export type TemplateScope = { args: Record<string, unknown>; inputs: Record<string, unknown> };
export type Placeholder = { kind: "args" | "inputs"; path: string };

/** A template could not be resolved (missing value, bad URL, origin changed). The message is model-safe. */
export class TemplateError extends Error {
  override name = "TemplateError";
}

const PLACEHOLDER = /\{\{\s*(args|inputs)\.([A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}/g;
const EXACT = /^\{\{\s*(args|inputs)\.([A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}$/;
export const ORIGIN_RULE =
  "The address must start with https:// and a fixed host, or with one URL input such as {{inputs.baseUrl}}.";
const FIXED_ORIGIN = /^https:\/\/[^/?#{}\s]+/i;

function lookup(scope: TemplateScope, kind: Placeholder["kind"], path: string): unknown {
  let value: unknown = scope[kind];
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) {
      throw new TemplateError(`Missing value for ${kind}.${path}.`);
    }
    value = (value as Record<string, unknown>)[part];
  }
  if (value === undefined) throw new TemplateError(`Missing value for ${kind}.${path}.`);
  return value;
}

/**
 * True when a template value is exactly one `{{args.*}}` placeholder the model left out. Such a query entry is
 * dropped and such a body is not sent, so optional arguments stay optional.
 */
export function isOmittedArg(template: unknown, scope: TemplateScope): boolean {
  if (typeof template !== "string") return false;
  const exact = EXACT.exec(template);
  if (!exact || exact[1] !== "args") return false;
  try {
    lookup(scope, "args", exact[2]);
    return false;
  } catch {
    return true;
  }
}

const asText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Replaces every placeholder inside a string with its (encoded) text. */
function substituteString(text: string, scope: TemplateScope, encode: (text: string) => string = (t) => t): string {
  return text.replace(PLACEHOLDER, (_match, kind: Placeholder["kind"], path: string) =>
    encode(asText(lookup(scope, kind, path))),
  );
}

/**
 * Walks a parsed template (headers, query, body JSON) and substitutes inside string values; a string that is
 * exactly one placeholder takes the raw typed value. Keys are left alone.
 */
export function substitute(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === "string") {
    const exact = EXACT.exec(value);
    return exact ? lookup(scope, exact[1] as Placeholder["kind"], exact[2]) : substituteString(value, scope);
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, scope));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, scope)]));
  return value;
}

/** Every placeholder used anywhere inside a template value. */
export function placeholders(value: unknown): Placeholder[] {
  if (typeof value === "string")
    return [...value.matchAll(PLACEHOLDER)].map((match) => ({ kind: match[1] as Placeholder["kind"], path: match[2] }));
  if (Array.isArray(value)) return value.flatMap(placeholders);
  if (value && typeof value === "object") return Object.values(value).flatMap(placeholders);
  return [];
}

/**
 * Splits a URL template into its origin source and the rest. The origin is either fixed (`https://host[:port]`)
 * or a single leading `{{inputs.<id>}}` placeholder.
 */
export function splitUrlTemplate(
  template: string,
): { origin: { fixed: string } | { input: string }; rest: string } | { error: string } {
  const leading = /^\{\{\s*(args|inputs)\.([A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}/.exec(template);
  if (leading) {
    if (leading[1] !== "inputs" || leading[2].includes("."))
      return {
        error: ORIGIN_RULE,
      };
    return { origin: { input: leading[2] }, rest: template.slice(leading[0].length) };
  }
  const fixed = FIXED_ORIGIN.exec(template);
  if (!fixed)
    return {
      error: ORIGIN_RULE,
    };
  return { origin: { fixed: fixed[0] }, rest: template.slice(fixed[0].length) };
}

/**
 * Resolves the URL template and query map. Path placeholders are percent-encoded, query values go through
 * URLSearchParams, and the final origin must equal the origin the template fixed (or the URL input's).
 */
export function resolveUrl(template: string, query: Record<string, string>, scope: TemplateScope): URL {
  const split = splitUrlTemplate(template);
  if ("error" in split) throw new TemplateError(split.error);
  const base = "fixed" in split.origin ? split.origin.fixed : asText(lookup(scope, "inputs", split.origin.input));
  let expected: string;
  try {
    expected = new URL(base).origin;
  } catch {
    throw new TemplateError("The base URL input is not a valid address.");
  }
  const rest = substituteString(split.rest, scope, encodeURIComponent);
  const joined = base.endsWith("/") && rest.startsWith("/") ? base + rest.slice(1) : base + rest;
  let url: URL;
  try {
    url = new URL(joined);
  } catch {
    throw new TemplateError("The resolved address is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new TemplateError("The tool address must use https.");
  if (url.origin !== expected || url.username || url.password)
    throw new TemplateError("The resolved address changed the server it points to.");
  for (const [name, value] of Object.entries(query))
    if (!isOmittedArg(value, scope)) url.searchParams.append(name, asText(substitute(value, scope)));
  return url;
}
