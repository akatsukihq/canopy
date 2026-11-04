/// <reference lib="webworker" />
// TypeScript 5 language service for the JS/TS code editors. The app's own `typescript` is the native
// v7 compiler, which has no in-browser API, so the worker bundles the JS build under an alias.
import ts from "typescript-browser";

import type { TsRequest, TsResponse } from "./tsIntelligence";

const LIB_URL = `/code/vendor/typescript/${ts.version}/lib.json`;
const DEFAULT_LIB = "/lib.es2023.d.ts";
const SHIM = "/runtime.d.ts";
// ponytail: loose Node/runtime globals instead of @types/node; bundle real typings if precise Node APIs matter.
const SHIM_TEXT = `
interface Console {
  /** Prints values to standard output, separated by spaces. */
  log(...data: any[]): void;
  /** Prints values to standard error. */
  error(...data: any[]): void;
  warn(...data: any[]): void;
  info(...data: any[]): void;
  debug(...data: any[]): void;
  /** Prints an array or object as a table. */
  table(tabularData: any, properties?: string[]): void;
  dir(item: any, options?: any): void;
  time(label?: string): void;
  timeEnd(label?: string): void;
}
declare var console: Console;
/** The running Node.js process: argv, env, stdin, stdout, exit(). */
declare var process: any;
declare var Buffer: any;
declare var module: any;
declare var exports: any;
declare var __dirname: string;
declare var __filename: string;
/** Loads a CommonJS module, such as require("fs") or require("readline"). */
declare function require(id: string): any;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
declare module "*";
`;

let fileName = "/main.ts";
let code = "";
let version = 0;
const libs = new Map<string, ts.IScriptSnapshot>([[SHIM, ts.ScriptSnapshot.fromString(SHIM_TEXT)]]);
let service: ts.LanguageService | null = null;

function readSnapshot(path: string) {
  return path === fileName ? ts.ScriptSnapshot.fromString(code) : libs.get(path);
}

async function initialize(javascript: boolean) {
  fileName = javascript ? "/main.js" : "/main.ts";
  const response = await fetch(LIB_URL);
  if (!response.ok) throw new Error(`TypeScript libraries failed to load (${response.status})`);
  const files = (await response.json()) as Record<string, string>;
  for (const [name, text] of Object.entries(files)) libs.set(`/${name}`, ts.ScriptSnapshot.fromString(text));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [fileName, SHIM],
    getScriptVersion: (path) => (path === fileName ? String(version) : "0"),
    getScriptSnapshot: readSnapshot,
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => DEFAULT_LIB,
    fileExists: (path) => path === fileName || libs.has(path),
    readFile: (path) => {
      const snapshot = readSnapshot(path);
      return snapshot?.getText(0, snapshot.getLength());
    },
  };
  service = ts.createLanguageService(host, ts.createDocumentRegistry());
}

const text = ts.displayPartsToString;

function documentation(parts?: ts.SymbolDisplayPart[], tags?: ts.JSDocTagInfo[]) {
  const lines = [text(parts)];
  for (const tag of tags ?? []) lines.push(`@${tag.name} ${text(tag.text)}`.trim());
  return lines.filter(Boolean).join("\n\n");
}

const COMPLETION_TYPES: Partial<Record<string, string>> = {
  function: "function",
  "local function": "function",
  method: "method",
  constructor: "class",
  class: "class",
  "local class": "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  "enum member": "enum",
  module: "namespace",
  keyword: "keyword",
  const: "constant",
  property: "property",
  getter: "property",
  setter: "property",
  parameter: "variable",
  let: "variable",
  var: "variable",
  "local var": "variable",
};

function handle(request: TsRequest): unknown {
  if (!service) return null;
  switch (request.type) {
    case "update":
      code = request.code;
      version += 1;
      return null;
    case "complete": {
      const result = service.getCompletionsAtPosition(fileName, request.pos, {
        includeCompletionsWithInsertText: true,
        includeCompletionsWithSnippetText: false,
      });
      return result?.entries.map((entry) => ({
        label: entry.name,
        type: COMPLETION_TYPES[entry.kind] ?? "text",
        sortText: entry.sortText,
        insertText: entry.insertText,
        source: entry.source,
      }));
    }
    case "completionDetails": {
      const details = service.getCompletionEntryDetails(
        fileName,
        request.pos,
        request.name,
        undefined,
        request.source,
        undefined,
        undefined,
      );
      return details
        ? { signature: text(details.displayParts), docs: documentation(details.documentation, details.tags) }
        : null;
    }
    case "hover": {
      const info = service.getQuickInfoAtPosition(fileName, request.pos);
      if (!info) return null;
      return {
        from: info.textSpan.start,
        to: info.textSpan.start + info.textSpan.length,
        signature: text(info.displayParts),
        docs: documentation(info.documentation, info.tags),
      };
    }
    case "definition": {
      const target = service
        .getDefinitionAtPosition(fileName, request.pos)
        ?.find((entry) => entry.fileName === fileName);
      return target ? target.textSpan.start : null;
    }
    case "signature": {
      const help = service.getSignatureHelpItems(fileName, request.pos, undefined);
      const item = help?.items[help.selectedItemIndex];
      if (!help || !item) return null;
      const separator = text(item.separatorDisplayParts);
      return {
        prefix: text(item.prefixDisplayParts),
        params: item.parameters.map((parameter) => ({
          label: text(parameter.displayParts),
          docs: text(parameter.documentation),
        })),
        separator,
        suffix: text(item.suffixDisplayParts),
        // Parameter docs already show beside the active parameter.
        docs: documentation(
          item.documentation,
          item.tags.filter((tag) => tag.name !== "param"),
        ),
        active: help.argumentIndex,
      };
    }
    case "diagnostics":
      return [...service.getSyntacticDiagnostics(fileName), ...service.getSemanticDiagnostics(fileName)].flatMap(
        (diagnostic) =>
          diagnostic.start === undefined
            ? []
            : [
                {
                  from: diagnostic.start,
                  to: diagnostic.start + (diagnostic.length ?? 0),
                  message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
                  severity:
                    diagnostic.category === ts.DiagnosticCategory.Error
                      ? "error"
                      : diagnostic.category === ts.DiagnosticCategory.Warning
                        ? "warning"
                        : "info",
                },
              ],
      );
    default:
      return null;
  }
}

let ready: Promise<void> | null = null;

self.onmessage = async (event: MessageEvent<TsRequest>) => {
  const request = event.data;
  let response: TsResponse;
  try {
    if (request.type === "init") {
      ready ??= initialize(request.javascript);
      await ready;
      response = { id: request.id, result: null };
    } else {
      await ready;
      response = { id: request.id, result: handle(request) };
    }
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
