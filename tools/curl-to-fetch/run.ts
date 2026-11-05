/**
 * Moved verbatim from the `curl-to-fetch` case in
 * `lib/devtools/format-json.ts` (arm at line 2627) together with its
 * single-consumer helper `curlAsFetch` (format-json.ts:3882-3889).
 *
 * `parseCurl` and `shellTokens` are shared with the sibling `curl-to-axios`
 * tool and live in `lib/devtools/shared/curl.ts`; they are imported here rather
 * than inlined, so both tools keep parsing curl identically.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseCurl } from "../../lib/devtools/shared/curl.ts";

type Settings = {
  readonly outputLanguage: string;
  readonly responseHandling: string;
  readonly executionStyle: string;
};

function curlAsFetch(command: string, settings: Settings): string {
  const request = parseCurl(command);
  const typed = settings.outputLanguage === "typescript";
  const responseType = typed ? ": Response" : "";
  const dataType = typed ? ": unknown" : "";
  const init: Record<string, unknown> = {};
  if (request.method !== "GET") init.method = request.method;
  if (Object.keys(request.headers).length) init.headers = request.headers;
  if (request.body !== undefined) init.body = request.body;
  const fetchLine = `const response${responseType} = await fetch(${JSON.stringify(request.url)}, ${JSON.stringify(init, null, 2)});`;
  const rawResponse = settings.responseHandling === "raw";

  if (settings.executionStyle === "async-function") {
    const body = rawResponse
      ? `${fetchLine}\nreturn response;`
      : `${fetchLine}\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nreturn response.json();`;
    const returnType = typed ? `: Promise<${rawResponse ? "Response" : "unknown"}>` : "";
    return `async function request()${returnType} {\n${body.replaceAll("\n", "\n  ").replace(/^/, "  ")}\n}\n\nconst ${rawResponse ? `response${responseType}` : `data${dataType}`} = await request();`;
  }

  return rawResponse
    ? fetchLine
    : `${fetchLine}\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconst data${dataType} = await response.json();`;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => ({
  render: "text",
  text: curlAsFetch(ctx.input.text, ctx.settings),
});

export default run;
