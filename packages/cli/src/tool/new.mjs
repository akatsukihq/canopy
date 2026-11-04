import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadCategories, TOOL_APPS, TOOL_KEY_PATTERN, withDatabase } from "../repo.mjs";

const RUN_FILES = { client: "run.ts", worker: "run.worker.ts", server: "run.server.ts" };

const RUN_SOURCE = `import type { ToolRun } from "@/lib/tool-framework/run";

const run: ToolRun = (ctx) => ({ render: "text", text: ctx.input.text });

export default run;
`;

const ICON_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>
`;

const titleCase = (key) =>
  key
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

/** The spec a new tool starts with; the developer edits it in local Admin. */
export function starterSpec({ app, key, category }) {
  return {
    toolId: `${app}.${key}`,
    app,
    category,
    keywords: [],
    name: titleCase(key),
    description: "TODO: one sentence describing what this tool does.",
    input: { kind: "text", label: "Input" },
    settings: { fields: {} },
    trigger: { mode: "live" },
    labels: { result: "Result", empty: "Paste input to begin.", ready: "Ready.", running: "Working…" },
    content: { howToUse: ["TODO: describe the first step."] },
  };
}

/**
 * Creates `tools/<key>/` and a disabled `managed_tools` row holding the starter
 * spec in the local database. Nothing else registers a tool.
 */
export async function newTool(root, { key, app, category, runtime }) {
  if (!key || !TOOL_KEY_PATTERN.test(key)) throw new Error("Tool key must be kebab-case, e.g. xml-formatter.");
  if (!TOOL_APPS.includes(app)) throw new Error(`--app must be one of: ${TOOL_APPS.join(", ")}`);
  const runFile = RUN_FILES[runtime];
  if (!runFile) throw new Error(`--runtime must be one of: ${Object.keys(RUN_FILES).join(", ")}`);
  const categories = await loadCategories(root);
  if (categories[category]?.app !== app) {
    const valid = Object.keys(categories).filter((name) => categories[name].app === app);
    throw new Error(`--category for --app ${app} must be one of: ${valid.join(", ")}`);
  }
  const dir = path.join(root, "tools", key);
  if (existsSync(dir)) throw new Error(`tools/${key} already exists.`);

  const spec = starterSpec({ app, key, category });
  await withDatabase(root, (client) =>
    client.query(
      `INSERT INTO managed_tools (tool_id, app, slug, name, description, sort_order, spec, enabled, archived)
       SELECT $1, $2, $3, $4, $5, COALESCE(MAX(sort_order), -1) + 1, $6::json, false, false
       FROM managed_tools WHERE app = $2`,
      [spec.toolId, app, key, spec.name, spec.description, JSON.stringify(spec)],
    ),
  );
  await mkdir(dir);
  await writeFile(path.join(dir, runFile), RUN_SOURCE);
  await writeFile(path.join(dir, "icon.svg"), ICON_SOURCE);
  return { toolId: spec.toolId, files: [`tools/${key}/${runFile}`, `tools/${key}/icon.svg`] };
}
