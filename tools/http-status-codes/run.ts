/**
 * Keeps the copyable code/phrase lines and exposes the same matches as
 * structured rows for the tool's readable result preview.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly category: string;
  readonly searchMode: string;
};

const HTTP_STATUSES: Readonly<Record<number, string>> = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  418: "I'm a Teapot",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const query = ctx.input.text.trim().toLowerCase();
  const category = ctx.settings.category ?? "all";
  const searchMode = ctx.settings.searchMode ?? "code-and-phrase";
  const matches = Object.entries(HTTP_STATUSES).filter(([code, phrase]) => {
    if (category !== "all" && !code.startsWith(category.charAt(0))) return false;
    if (!query) return true;
    return (
      (searchMode !== "phrase-only" && code.includes(query)) ||
      (searchMode !== "code-only" && phrase.toLowerCase().includes(query))
    );
  });
  if (!matches.length) {
    throw new ToolError(
      "no-match",
      "No matching HTTP status code was found.",
      "Try a shorter query, select All categories, or change the search mode to Code + phrase.",
      { messageRef: { key: "execution.errors.no-match" }, recoveryMessage: { key: "execution.recovery.no-match" } },
    );
  }
  return {
    render: "text",
    text: matches.map(([code, phrase]) => `${code} ${phrase}`).join("\n"),
    tablePreview: {
      render: "table",
      columns: ["Code", "Reason phrase"],
      columnMessages: [{ key: "execution.code" }, { key: "execution.reasonPhrase" }],
      rows: matches,
    },
  };
};

export default run;
