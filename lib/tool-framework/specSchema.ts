/**
 * The trust boundary for stored tool specs.
 *
 * Specs are data now: an administrator edits them and the database stores
 * them. Every load and every save goes through `parseToolSpec`, so the app
 * never acts on a shape `spec.ts` does not describe. Objects are strict: an
 * unknown key is a typo the editor should show, not a field silently ignored.
 */
import { z } from "zod";

import { TOOL_CATEGORIES, type CategoryKey } from "./categories";
import type { FieldSpec, SettingsSpec } from "./settings";
import type { ToolSpec } from "./spec";
import type { WatermarkPosition } from "./workerProtocol";

const LANGUAGES = [
  "json",
  "unicode",
  "url-encoded",
  "url",
  "jwt",
  "qr",
  "xml",
  "html",
  "yaml",
  "javascript",
  "typescript",
  "css",
  "bash",
  "sql",
  "markdown",
  "csv",
  "tsv",
  "mermaid",
] as const;
const POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const satisfies readonly WatermarkPosition[];

const text = z.string().min(1);
const count = z.number().int().positive();
const language = z.enum(LANGUAGES);

const choice = z.strictObject({ label: text, value: z.string(), aspectRatio: z.number().positive().optional() });
const base = {
  label: text,
  help: z.string().optional(),
  pane: z.enum(["main", "side", "input"]).optional(),
  span: z.union([z.literal(1), z.literal(2), z.literal("full")]).optional(),
  visibleWhen: z.strictObject({ key: text, equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
};
const pageSelection = z.union([z.enum(["all", "odd", "even"]), z.array(count).min(1)]);

const field = z.discriminatedUnion("kind", [
  z.strictObject({
    ...base,
    kind: z.literal("text"),
    default: z.string(),
    placeholder: z.string().optional(),
    maxLength: count.optional(),
  }),
  z.strictObject({ ...base, kind: z.literal("textarea"), default: z.string(), rows: count.optional() }),
  z.strictObject({ ...base, kind: z.literal("password"), default: z.string(), placeholder: z.string().optional() }),
  z.strictObject({
    ...base,
    kind: z.literal("number"),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    suffix: z.string().optional(),
    leadingIcon: z.literal("rotate-cw").optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("slider"),
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    suffix: z.string().optional(),
  }),
  z.strictObject({ ...base, kind: z.literal("toggle"), default: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("select"), default: z.string(), choices: z.array(choice).min(1) }),
  z.strictObject({
    ...base,
    kind: z.literal("preset"),
    default: z.string(),
    choices: z.array(choice.extend({ detail: z.string().optional() })).min(1),
  }),
  z.strictObject({ ...base, kind: z.literal("color"), default: z.string(), allowTransparent: z.boolean().optional() }),
  z.strictObject({ ...base, kind: z.literal("date"), default: z.string() }),
  z.strictObject({ ...base, kind: z.literal("position"), default: z.enum(POSITIONS) }),
  z.strictObject({ ...base, kind: z.literal("pages"), default: pageSelection, presets: z.boolean().optional() }),
  z.strictObject({
    ...base,
    kind: z.literal("rows"),
    default: z.array(z.strictObject({ key: z.string(), value: z.string() })),
    keyLabel: text,
    valueLabel: text,
  }),
]);

const inputField = z.strictObject({
  channel: z.enum(["text", "secondary"]),
  label: text,
  placeholder: z.string().optional(),
  secret: z.boolean().optional(),
  required: z.boolean().optional(),
  multiline: z.boolean().optional(),
  language: language.optional(),
  surface: z.literal("card").optional(),
  maxLength: count.optional(),
});

const input = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    label: text,
    required: z.boolean().optional(),
    language: language.optional(),
    showLineNumbers: z.boolean().optional(),
    placeholder: z.string().optional(),
    surface: z.literal("card").optional(),
    maxLength: count.optional(),
    secondary: z
      .strictObject({ label: text, placeholder: z.string().optional(), language: language.optional() })
      .optional(),
    acceptFiles: z.strictObject({ accept: text, maxBytes: count, maxEditableBytes: count.optional() }).optional(),
  }),
  z.strictObject({
    kind: z.literal("fields"),
    label: text,
    fields: z.array(inputField).min(1),
    resizable: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("files"),
    label: text,
    dropzoneDescription: z.string().optional(),
    accept: text,
    multiple: z.boolean(),
    engine: z.enum(["image", "pdf"]),
    maxFiles: count.optional(),
    maxBytes: count.optional(),
    maxTotalBytes: count.optional(),
    inspect: z.boolean().optional(),
  }),
]);

const example = z.strictObject({
  label: text,
  text: z.string(),
  secondary: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const spec = z.strictObject({
  toolId: z.string().regex(/^(devtools|media)\.[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be <app>.<kebab-case-key>"),
  app: z.enum(["devtools", "media"]),
  slug: z.string().optional(),
  category: z.string().refine((value) => Object.hasOwn(TOOL_CATEGORIES, value), "is not a known category"),
  keywords: z.array(text),
  name: text,
  description: text,
  input,
  outputLanguage: language.optional(),
  outputShowLineNumbers: z.boolean().optional(),
  previewLayout: z.enum(["document", "table"]).optional(),
  resultView: z
    .strictObject({
      default: z.enum(["raw", "preview"]),
      previewLabel: z.string().optional(),
      showTabs: z.boolean().optional(),
    })
    .optional(),
  resultStats: z.enum(["cards", "status-only"]).optional(),
  settings: z.strictObject({ fields: z.record(z.string().regex(/^[A-Za-z][\w.]*$/), field) }),
  trigger: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("live"), debounceMs: z.number().int().nonnegative().optional() }),
    z.strictObject({ mode: z.literal("manual"), actionLabel: text }),
  ]),
  sharing: z.strictObject({ version: count }).optional(),
  capabilities: z
    .strictObject({
      cancel: z.boolean().optional(),
      copy: z.boolean().optional(),
      download: z.boolean().optional(),
      progress: z.boolean().optional(),
      network: z.boolean().optional(),
    })
    .optional(),
  layout: z.enum(["side-by-side", "stacked"]).optional(),
  inputSize: z
    .strictObject({
      default: z.number().min(0).max(100),
      min: z.number().min(0).max(100).optional(),
      max: z.number().min(0).max(100).optional(),
    })
    .optional(),
  optionsPanel: z
    .strictObject({
      collapsible: z.boolean().optional(),
      defaultCollapsed: z.boolean().optional(),
      layout: z.enum(["grid", "stack"]).optional(),
      note: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
  workbenchMark: z.strictObject({ text: text, tone: z.enum(["accent", "contrast"]).optional() }).optional(),
  labels: z.strictObject({ empty: text, ready: text, result: z.string().optional(), running: text }),
  content: z.strictObject({
    seoTitle: z.string().optional(),
    howToUse: z.array(text),
    limitations: z.array(text).optional(),
    faq: z.array(z.strictObject({ q: text, a: text })).optional(),
    examples: z.array(example).optional(),
    relatedToolIds: z.array(text).optional(),
  }),
  messages: z.record(z.string(), z.string()).optional(),
});

/** Rules a schema cannot express: cross-field references and defaults. */
function crossFieldIssues(value: z.infer<typeof spec>): string[] {
  const issues: string[] = [];
  const [app] = value.toolId.split(".");
  if (app !== value.app) issues.push(`app: must match the toolId prefix "${app}"`);
  if (TOOL_CATEGORIES[value.category as CategoryKey].app !== value.app) {
    issues.push(`category: "${value.category}" belongs to ${TOOL_CATEGORIES[value.category as CategoryKey].app}`);
  }
  const fields = value.settings.fields;
  for (const [key, setting] of Object.entries(fields)) {
    const path = `settings.fields.${key}`;
    if (
      (setting.kind === "select" || setting.kind === "preset") &&
      !setting.choices.some((c) => c.value === setting.default)
    ) {
      issues.push(`${path}.default: "${setting.default}" is not one of its choices`);
    }
    if (
      (setting.kind === "number" || setting.kind === "slider") &&
      setting.min !== undefined &&
      setting.max !== undefined
    ) {
      if (setting.min > setting.max) issues.push(`${path}: min is greater than max`);
      else if (setting.default < setting.min || setting.default > setting.max) {
        issues.push(`${path}.default: must be between min and max`);
      }
    }
    if (setting.visibleWhen && !Object.hasOwn(fields, setting.visibleWhen.key)) {
      issues.push(`${path}.visibleWhen.key: "${setting.visibleWhen.key}" is not a setting`);
    }
  }
  value.content.examples?.forEach((entry, index) => {
    for (const key of Object.keys(entry.settings ?? {})) {
      if (!Object.hasOwn(fields, key)) issues.push(`content.examples.${index}.settings.${key}: not a setting`);
    }
  });
  return issues;
}

export type SpecParseResult =
  { readonly ok: true; readonly spec: ToolSpec } | { readonly ok: false; readonly issues: readonly string[] };

/** Validates untrusted JSON as a tool spec, with one readable message per problem. */
export function parseToolSpec(value: unknown): SpecParseResult {
  const parsed = spec.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`),
    };
  }
  const issues = crossFieldIssues(parsed.data);
  if (issues.length) return { ok: false, issues };
  return { ok: true, spec: parsed.data as ToolSpec };
}

// Compile-time guard: the schema's field union must stay assignable to FieldSpec.
type _FieldCheck = z.infer<typeof field> extends FieldSpec ? true : never;
type _SettingsCheck = z.infer<typeof spec>["settings"] extends SettingsSpec ? true : never;
const _checks: [_FieldCheck, _SettingsCheck] = [true, true];
void _checks;
