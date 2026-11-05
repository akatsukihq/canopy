import type { ToolSpec } from "@/lib/tool-framework/spec";
/** Tools that share one workspace and can switch output format in place. */
export const IMAGE_CONVERSION_KEYS: readonly string[] = [
  "jpg-to-png",
  "jpg-to-webp",
  "png-to-jpg",
  "png-to-webp",
  "webp-to-jpg",
  "webp-to-png",
  "heic-to-jpg",
  "heic-to-png",
];
export const IMAGE_OUTPUT_KEY = "imageOutputFormat";

/**
 * `conversions` are the sibling specs the page loaded from the database;
 * empty for every other tool.
 */
export function resolveImageConversion(
  original: ToolSpec,
  values: Readonly<Record<string, unknown>>,
  conversions: readonly ToolSpec[] = [],
) {
  const registered = conversions.find((entry) => entry.toolId === original.toolId);
  const key = original.toolId.split(".")[1];
  const [source, initialTarget] = key.split("-to-");
  const choices = registered ? conversions.filter((entry) => entry.toolId.startsWith(`media.${source}-to-`)) : [];
  const selected = choices.find((entry) => entry.toolId === `media.${source}-to-${values[IMAGE_OUTPUT_KEY]}`);
  const spec = selected && selected.toolId !== original.toolId ? selected : original;
  const target = selected ? selected.toolId.split("-to-")[1] : initialTarget;
  const settingKey = (field: string) => (target === initialTarget ? field : `conversion.${target}.${field}`);
  const settings = registered
    ? Object.fromEntries(
        Object.entries(spec.settings.fields).map(([field, definition]) => [
          field,
          values[settingKey(field)] ?? definition.default,
        ]),
      )
    : values;
  return { spec, key: spec.toolId.split(".")[1], source, target, choices, settings, settingKey };
}
