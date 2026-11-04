/**
 * Moved verbatim from the `json-schema-validator` case in
 * `lib/devtools/format-json.ts`, together with its `validateJsonSchema`
 * helper — this tool is that helper's only consumer, so it lives here rather
 * than in `lib/devtools/shared/`.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolValidationIssue } from "../../lib/tool-framework/result.ts";
import { jsonType, parseStrictJson } from "../../lib/devtools/shared/json-input.ts";
import { isRecord } from "../../lib/devtools/shared/json.ts";
import type { JsonSchemaResult } from "./result.ts";

type Settings = {};

type ValidationProgress = {
  valuesChecked: number;
  checks: Map<string, { keyword: string; passed: number; failed: number }>;
};

const IMPLEMENTED_KEYWORDS = new Set([
  "type",
  "enum",
  "required",
  "properties",
  "items",
  "minLength",
  "maxLength",
  "pattern",
]);
const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "default",
  "examples",
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
]);

function ignoredSchemaKeywords(schema: unknown): string[] {
  const ignored = new Set<string>();
  const pending = [schema];
  while (pending.length) {
    const current = pending.pop();
    if (!isRecord(current)) continue;
    for (const keyword of Object.keys(current)) {
      if (!IMPLEMENTED_KEYWORDS.has(keyword) && !ANNOTATION_KEYWORDS.has(keyword)) ignored.add(keyword);
    }
    if (isRecord(current.properties)) {
      for (const child of Object.values(current.properties)) pending.push(child);
    }
    if (current.items !== undefined) pending.push(current.items);
  }
  return [...ignored].sort();
}

function recordCheck(progress: ValidationProgress, keyword: string, passed: boolean): boolean {
  const check = progress.checks.get(keyword) ?? { keyword, passed: 0, failed: 0 };
  if (passed) check.passed += 1;
  else check.failed += 1;
  progress.checks.set(keyword, check);
  return passed;
}

function equalJsonValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equalJsonValues(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalJsonValues(left[key], right[key]))
  );
}

function schemaIssue(key: string, message: string, values: Record<string, string | number>): ToolValidationIssue {
  return { target: "input", message, messageRef: { key: `schema.${key}`, values } };
}

function validateJsonSchema(
  value: unknown,
  schema: unknown,
  progress: ValidationProgress,
  path = "$",
): ToolValidationIssue[] {
  progress.valuesChecked += 1;
  if (!isRecord(schema)) {
    recordCheck(progress, "schema", false);
    return [schemaIssue("objectRequired", `${path}: schema must be an object`, { path })];
  }
  const errors: ToolValidationIssue[] = [];
  const expected = schema.type;
  const actual = jsonType(value);
  const matchesType =
    expected === undefined ||
    (Array.isArray(expected) ? expected : [expected]).some(
      (type) => type === actual || (type === "integer" && typeof value === "number" && Number.isInteger(value)),
    );
  if (expected !== undefined) recordCheck(progress, "type", matchesType);
  if (!matchesType)
    return [
      schemaIssue("typeMismatch", `${path}: expected ${String(expected)}, received ${actual}`, {
        path,
        expected: String(expected),
        actual,
      }),
    ];
  if (
    Array.isArray(schema.enum) &&
    !recordCheck(
      progress,
      "enum",
      schema.enum.some((item) => equalJsonValues(item, value)),
    )
  ) {
    errors.push(schemaIssue("enumMismatch", `${path}: value is not in enum`, { path }));
  }
  if (isRecord(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !recordCheck(progress, "required", Object.hasOwn(value, key)))
          errors.push(schemaIssue("required", `${path}.${key}: is required`, { path: `${path}.${key}` }));
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key))
          errors.push(...validateJsonSchema(value[key], childSchema, progress, `${path}.${key}`));
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchema(item, schema.items, progress, `${path}[${index}]`));
    });
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof schema.minLength === "number" && !recordCheck(progress, "minLength", length >= schema.minLength)) {
      errors.push(
        schemaIssue("minimumLength", `${path}: must contain at least ${schema.minLength} characters`, {
          path,
          count: schema.minLength,
        }),
      );
    }
    if (typeof schema.maxLength === "number" && !recordCheck(progress, "maxLength", length <= schema.maxLength)) {
      errors.push(
        schemaIssue("maximumLength", `${path}: must contain at most ${schema.maxLength} characters`, {
          path,
          count: schema.maxLength,
        }),
      );
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!recordCheck(progress, "pattern", new RegExp(schema.pattern).test(value)))
          errors.push(schemaIssue("patternMismatch", `${path}: does not match pattern`, { path }));
      } catch {
        recordCheck(progress, "pattern", false);
        errors.push(schemaIssue("invalidPattern", `${path}: schema pattern is invalid`, { path }));
      }
    }
  }
  return errors;
}

export const run: ToolRun<Settings> = (ctx): JsonSchemaResult => {
  const value = parseStrictJson(ctx.input.text, "JSON data", "data");
  const schema = parseStrictJson(ctx.input.secondary ?? "", "JSON schema", "schema");
  const progress: ValidationProgress = { valuesChecked: 0, checks: new Map() };
  const errors = validateJsonSchema(value, schema, progress);
  return {
    render: "text",
    text: errors.length
      ? `Invalid\n${errors.map((error) => `- ${error.message}`).join("\n")}`
      : "Valid against schema.",
    report: {
      rootType: jsonType(value),
      schemaTitle: isRecord(schema) && typeof schema.title === "string" ? schema.title : undefined,
      schemaDialect: isRecord(schema) && typeof schema.$schema === "string" ? schema.$schema : undefined,
      valuesChecked: progress.valuesChecked,
      checks: [...progress.checks.values()],
      ignoredKeywords: ignoredSchemaKeywords(schema),
    },
    issues: errors.length ? errors : undefined,
    verdict: errors.length
      ? {
          level: "error",
          label: "Invalid",
          labelMessage: { key: "schema.invalid" },
          detail: `${errors.length} problem${errors.length === 1 ? "" : "s"}`,
          detailMessage: { key: "schema.problemCount", values: { count: errors.length } },
        }
      : { level: "ok", label: "Valid against schema", labelMessage: { key: "schema.valid" } },
  };
};

export default run;
