/**
 * Moved verbatim from the `curl-to-axios` case in
 * `lib/devtools/format-json.ts` (line 2629) plus its single-consumer helper
 * `curlAsAxios` (line 3891).
 *
 * `parseCurl` / `shellTokens` are imported from `lib/devtools/shared/curl.ts`
 * and deliberately not inlined: the sibling `curl-to-fetch` tool parses the
 * same commands, and two copies of a shell tokenizer would drift.
 */

import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseCurl, shellTokens } from "../../lib/devtools/shared/curl.ts";

type Settings = {
  readonly moduleFormat: string;
  readonly requestStyle: string;
  readonly outputLanguage: string;
};
type CurlRequest = ReturnType<typeof parseCurl>;

const FLAGS_WITH_VALUES = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "-u",
  "--user",
]);
const METHOD_ALIASES = new Set(["get", "delete", "head", "options", "post", "put", "patch"]);

function parseBody(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function requestConfig(request: CurlRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    method: request.method.toLowerCase(),
    url: request.url,
  };
  if (Object.keys(request.headers).length) config.headers = request.headers;
  if (request.body !== undefined) config.data = parseBody(request.body);
  return config;
}

function aliasCall(request: CurlRequest, config: Record<string, unknown>): string {
  const method = request.method.toLowerCase();
  if (!METHOD_ALIASES.has(method)) {
    return `axios.request(${JSON.stringify(config, null, 2)})`;
  }

  const data = config.data;
  const options = { ...config };
  delete options.method;
  delete options.url;
  delete options.data;
  const hasOptions = Object.keys(options).length > 0;
  const url = JSON.stringify(request.url);

  if (method === "post" || method === "put" || method === "patch") {
    if (data === undefined && !hasOptions) return `axios.${method}(${url})`;
    return `axios.${method}(${url}, ${data === undefined ? "undefined" : JSON.stringify(data, null, 2)}${hasOptions ? `, ${JSON.stringify(options, null, 2)}` : ""})`;
  }

  if (data !== undefined) options.data = data;
  return `axios.${method}(${url}${Object.keys(options).length ? `, ${JSON.stringify(options, null, 2)}` : ""})`;
}

function unsupportedFlags(command: string): string[] {
  const flags = new Set<string>();
  const tokens = shellTokens(command);
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (FLAGS_WITH_VALUES.has(token)) {
      index += 1;
    } else if (token.startsWith("-") && token !== "-") {
      flags.add(token.split("=", 1)[0]);
    }
  }
  return [...flags];
}

function curlAsAxios(command: string, settings: Settings): string {
  const request = parseCurl(command);
  const config = requestConfig(request);
  const call =
    settings.requestStyle === "alias"
      ? aliasCall(request, config)
      : `${settings.requestStyle === "request" ? "axios.request" : "axios"}(${JSON.stringify(config, null, 2)})`;
  const moduleLine =
    settings.moduleFormat === "esm"
      ? 'import axios from "axios";\n\n'
      : settings.moduleFormat === "commonjs"
        ? 'const axios = require("axios");\n\n'
        : "";
  const responseType = settings.outputLanguage === "typescript" ? ': import("axios").AxiosResponse<unknown>' : "";
  const statement = `const { data }${responseType} = await ${call};`;
  return settings.moduleFormat === "commonjs"
    ? `${moduleLine}(async () => {\n  ${statement.replaceAll("\n", "\n  ")}\n})();`
    : `${moduleLine}${statement}`;
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const flags = unsupportedFlags(ctx.input.text);
  const warning = `Unsupported cURL flags were ignored: ${flags.join(", ")}.`;
  const typed = ctx.settings.outputLanguage === "typescript";
  const extension = typed
    ? ctx.settings.moduleFormat === "esm"
      ? "mts"
      : ctx.settings.moduleFormat === "commonjs"
        ? "cts"
        : "ts"
    : ctx.settings.moduleFormat === "esm"
      ? "mjs"
      : ctx.settings.moduleFormat === "commonjs"
        ? "cjs"
        : "js";
  return {
    render: "text",
    text: curlAsAxios(ctx.input.text, ctx.settings),
    downloadName: `axios-request.${extension}`,
    ...(flags.length
      ? {
          notification: {
            level: "warn" as const,
            label: "Some cURL flags were not converted",
            labelMessage: { key: "curl.flagsNotConverted" },
            detail: warning,
            detailMessage: { key: "curl.unsupportedFlags", values: { flags: flags.join(", ") } },
          },
          issues: [
            {
              message: warning,
              messageRef: { key: "curl.unsupportedFlags", values: { flags: flags.join(", ") } },
              target: "input" as const,
            },
          ],
        }
      : {}),
  };
};

export default run;
