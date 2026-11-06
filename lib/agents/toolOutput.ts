/**
 * Output pipeline for custom tools: parse → responsePath → schema. No size cap at any stage.
 * Pure apart from the injected `transform` runner (Piston, for the `code` parser).
 */
import { z } from "zod";
import type { CodeToolConfig, ToolOutputConfig } from "./toolTypes.ts";

/** Runs a transform program: stdin in, stdout out, or a model-facing error result. */
export type TransformRunner = (
  config: CodeToolConfig,
  stdin: string,
) => Promise<{ ok: true; stdout: string } | { ok: false; error: Record<string, unknown> }>;

export type SchemaStatus = "freeform" | "passed" | "failed";
export type OutputResult =
  | { ok: true; parsed: unknown; value: unknown; schema: SchemaStatus }
  | { ok: false; parsed?: unknown; error: Record<string, unknown>; schema: SchemaStatus | null };

const MAX_ISSUES = 10;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable text from an HTML page: drops scripts, styles and tags, keeps block breaks, decodes entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Follows a dot path; numeric segments index arrays. */
export function readPath(value: unknown, path: string): { found: true; value: unknown } | { found: false } {
  let current = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

async function parse(
  output: ToolOutputConfig,
  raw: string,
  transformInput: unknown,
  transform: TransformRunner,
): Promise<{ ok: true; value: unknown } | { ok: false; error: Record<string, unknown> }> {
  switch (output.parser) {
    case "text":
      return { ok: true, value: raw };
    case "html-text":
      return { ok: true, value: htmlToText(raw) };
    case "json": {
      const json = tryJson(raw);
      return json.ok ? json : { ok: false, error: { error: "The response is not valid JSON." } };
    }
    case "code": {
      if (!output.transform) return { ok: false, error: { error: "The output transform is missing." } };
      const ran = await transform(output.transform, JSON.stringify(transformInput));
      if (!ran.ok) return ran;
      const json = tryJson(ran.stdout);
      return { ok: true, value: json.ok ? json.value : ran.stdout };
    }
    default: {
      // "auto": JSON whenever the body parses (a JSON content type that does not parse falls back to text).
      const json = tryJson(raw);
      return { ok: true, value: json.ok ? json.value : raw };
    }
  }
}

/** Runs the pipeline over a raw result (HTTP body or code stdout). */
export async function applyOutput(
  output: ToolOutputConfig,
  raw: string,
  options: { responsePath: string | null; transformInput: unknown; transform: TransformRunner },
): Promise<OutputResult> {
  const parsed = await parse(output, raw, options.transformInput, options.transform);
  if (!parsed.ok) return { ok: false, error: parsed.error, schema: null };
  let value = parsed.value;
  if (options.responsePath) {
    const found = readPath(value, options.responsePath);
    if (!found.found)
      return {
        ok: false,
        parsed: value,
        error: { error: `Response path "${options.responsePath}" was not found in the response.` },
        schema: null,
      };
    value = found.value;
  }
  if (!output.schema) return { ok: true, parsed: parsed.value, value, schema: "freeform" };
  const checked = z.fromJSONSchema(output.schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(value);
  if (checked.success) return { ok: true, parsed: parsed.value, value: checked.data, schema: "passed" };
  return {
    ok: false,
    parsed: parsed.value,
    schema: "failed",
    error: {
      error: "Output did not match schema",
      issues: checked.error.issues
        .slice(0, MAX_ISSUES)
        .map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
  };
}
