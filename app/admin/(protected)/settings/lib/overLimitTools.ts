import { parseToolSpec } from "@/lib/tool-framework/specSchema";
import { limitExceedances, type SystemLimits } from "@/lib/tool-framework/systemLimits";

export type OverLimitTool = { readonly toolId: string; readonly name: string; readonly paths: readonly string[] };

/**
 * Stored specs asking for more than a limit now allows, grouped by limit key.
 * Lowering a limit never rewrites specs, so this is how Admin finds them.
 */
export function toolsOverLimits(
  rows: readonly { readonly toolId: string; readonly name: string; readonly spec: unknown }[],
  limits: SystemLimits,
): Readonly<Record<string, readonly OverLimitTool[]>> {
  const byLimit: Record<string, OverLimitTool[]> = {};
  for (const row of rows) {
    const parsed = parseToolSpec(row.spec);
    if (!parsed.ok) continue;
    const paths: Record<string, string[]> = {};
    for (const { limit, path } of limitExceedances(parsed.spec, limits)) (paths[limit] ??= []).push(path);
    for (const [limit, limitPaths] of Object.entries(paths)) {
      (byLimit[limit] ??= []).push({ toolId: row.toolId, name: row.name, paths: limitPaths });
    }
  }
  return byLimit;
}
