import type { ToolResult } from "../../lib/tool-framework/result.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import { buildDocument, parseWebFiles } from "./files.ts";

export const run: ToolRun = (ctx): ToolResult => ({
  render: "html",
  html: buildDocument(parseWebFiles(ctx.input.text)),
  downloadName: "index.html",
  verdict: { level: "ok", label: "Your page is running in the preview." },
});

export default run;
