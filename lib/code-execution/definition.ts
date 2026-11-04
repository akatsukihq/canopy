/**
 * Builds the `definition.ts` default export of every `tools/*-compiler` folder
 * from its registry entry, so the versions, starter and limits are written
 * once. Loaded by the plain Node seed walk: value imports use `.ts` extensions
 * and nothing here touches React or `@/`.
 */
import type { ToolSpec } from "../tool-framework/spec";
import { CODE_LANGUAGES, DEFAULT_CODE_LIMITS } from "./languages.ts";
import { CODE_RUN_MESSAGES } from "./result.ts";

const CATEGORY = "compilers";
const SOURCE_KIB = 64;

const WORKSPACE_MESSAGES = {
  "codeRunner.editor": "{language} source code",
  "codeRunner.stdin": "Standard input (stdin)",
  "codeRunner.stdinHelp":
    "Type anything your program reads before you press Run. Input cannot be typed while the program is running.",
  "codeRunner.stdinPlaceholder": "Optional. For example: Ada",
  "codeRunner.run": "Run",
  "codeRunner.cancel": "Cancel",
  "codeRunner.runTooltip": "Run your program ({shortcut})",
  "codeRunner.cancelTooltip": "Stop this run. Your code stays as it is.",
  "codeRunner.running": "Running your program…",
  "codeRunner.cancelled": "Run cancelled. Your code is unchanged.",
  "codeRunner.reset": "Reset to starter",
  "codeRunner.resetTitle": "Reset to the starter program?",
  "codeRunner.resetBody": "Your current code is replaced by the starter program and your saved draft is removed.",
  "codeRunner.resetConfirm": "Reset",
  "codeRunner.resetKeep": "Keep my code",
  "codeRunner.upload": "Upload file",
  "codeRunner.uploadFailed": "{name} could not be read as text.",
  "codeRunner.uploadTooLarge": "{name} is larger than {max} KiB. Choose a smaller file.",
  "codeRunner.download": "Download source",
  "codeRunner.version": "{language} version",
  "codeRunner.versionTooltip": "Choose which version runs your code. Each run uses exactly that version.",
  "codeRunner.draftNote": "Your code is saved in this browser only, until you run it.",
  "codeRunner.resultPlaceholder": "Press Run to see what your program prints, or why it stopped.",
} as const;

export type CodeToolOptions = {
  /** Display name without "Online", e.g. "Python Compiler". */
  readonly name: string;
  /** Language name used in sentences, e.g. "Python". */
  readonly label: string;
  /** Short mark shown in the workbench chrome. */
  readonly mark: string;
  readonly keywords: readonly string[];
  /** Whether a separate compile step runs before the program. */
  readonly compiled: boolean;
  /** Syntax hint for the generic input spec; the workspace uses the registry's editor language. */
  readonly syntax?: "javascript" | "typescript" | "bash";
  /** One language-specific question. */
  readonly faq: { readonly q: string; readonly a: string };
};

/** "3.12.0" -> "3.12", "15.0.2" -> "15": the version as people say it. */
export function shortVersion(version: string): string {
  return version
    .split(".")
    .slice(0, 2)
    .join(".")
    .replace(/(\.0)+$/, "");
}

function relatedIds(definitionKey: string): readonly string[] {
  const keys = Object.keys(CODE_LANGUAGES);
  const at = keys.indexOf(definitionKey);
  return [1, 2, 3].map((step) => `devtools.${keys[(at + step) % keys.length]}`);
}

export function defineCodeTool(definitionKey: string, options: CodeToolOptions) {
  const language = CODE_LANGUAGES[definitionKey];
  if (!language) throw new Error(`No code language is registered for ${definitionKey}.`);
  const version = shortVersion(language.version);
  const runSeconds = DEFAULT_CODE_LIMITS.runTimeoutMs / 1000;
  const cpuSeconds = DEFAULT_CODE_LIMITS.runCpuTimeMs / 1000;
  const compileSeconds = DEFAULT_CODE_LIMITS.compileTimeoutMs / 1000;
  const named =
    language.runtime && !options.label.includes("(") ? `${options.label} (${language.runtime})` : options.label;
  const what = `${named} ${version}`;
  const versionList = language.versions.map((entry) => entry.label).join(", ");
  const multiple = language.versions.length > 1;
  // C and C++ standards share one compiler release, so list each release once.
  const releases = [
    ...new Set(language.versions.map((entry) => `${entry.runtime ?? ""} ${entry.version}`.trim())),
  ].join(", ");

  return {
    messages: { ...CODE_RUN_MESSAGES, ...WORKSPACE_MESSAGES },
    toolId: `devtools.${definitionKey}`,
    slug: definitionKey,
    app: "devtools",
    category: CATEGORY,
    keywords: options.keywords,
    name: options.name,
    description: `Write and run ${what} code in your browser. Add input, press Run, and read the output or the exact error. Nothing to install.`,
    input: {
      kind: "text",
      label: `${options.label} code`,
      language: options.syntax,
      showLineNumbers: true,
      maxLength: SOURCE_KIB * 1024,
      acceptFiles: { accept: `.${language.fileName.split(".").pop()},text/plain`, maxBytes: SOURCE_KIB * 1024 },
      secondary: { label: "Standard input (stdin)", placeholder: "Optional. For example: Ada" },
    },
    settings: {
      fields: {
        version: {
          kind: "select",
          label: "Version",
          help: "Each run uses exactly this version.",
          default: language.versionId,
          choices: language.versions.map((entry) => ({ value: entry.id, label: entry.label })),
        },
      },
    },
    // Facts go to the status bar so the sentence and the program output stay in view.
    resultStats: "status-only",
    trigger: { mode: "manual", actionLabel: "Run" },
    // network: the source is sent to the execution server, so the page must not claim to be browser-private.
    capabilities: { cancel: true, copy: true, download: true, network: true },
    workbenchMark: { text: options.mark, tone: "contrast" },
    labels: {
      result: "Result",
      empty: "Press Run to see what your program prints, or why it stopped.",
      ready: "Your program finished. The result explains what happened.",
      running: "Running your program…",
    },
    content: {
      seoTitle: `Online ${options.name} — Run ${what} Code`,
      howToUse: [
        `The editor starts with a small ${options.label} program that reads a name from standard input and greets it, so you can press Run straight away.`,
        `Write or paste your ${options.label} code. Anything your program reads from the keyboard goes in the Standard input box before you run it.`,
        "Press Run or Ctrl/Cmd+Enter. The result starts with one sentence saying what happened, followed by the output, error output and exit code.",
        `If something goes wrong the message names the cause${options.compiled ? ", including the line of a compile error" : ""}. Fix your code and run again. Your code is kept in this browser while you work.`,
      ],
      limitations: [
        multiple
          ? `You can run ${versionList}. Pick one in the version menu above the editor; each run uses that exact release.`
          : `This page runs ${named} ${language.version} exactly, so results stay the same until the page is updated.`,
        `Each run is stopped after ${runSeconds} seconds of running time (${cpuSeconds} seconds of CPU time)${options.compiled ? `; compiling may take up to ${compileSeconds} seconds` : ""}, and is limited to 256 MiB of memory and 64 KiB of output.`,
        `Source code and input are each limited to ${SOURCE_KIB} KiB. Command-line arguments are not supported.`,
        "There is no network access, no way to install packages and no files that last between runs.",
        "Input cannot be typed while the program runs. Put everything it will read in the Standard input box first.",
        "If many people run code at once, the server may ask you to wait a few seconds. Your code is kept when that happens.",
      ],
      faq: [
        {
          q: "Is my code sent to a server, and is it saved?",
          a: "Yes, your code and input are sent to Canopy's execution server so it can run the program. It runs once in an isolated sandbox and is not stored. A draft stays in your own browser so a refresh does not lose your work.",
        },
        {
          q: `Which ${options.label} ${multiple ? "versions can I use" : "version does this use"}?`,
          a: multiple
            ? `${versionList}. ${language.versions[0].label} is selected first; change it in the version menu above the editor. Each choice is an exact release (${releases}), so results stay the same until the page is updated.`
            : `${named} ${language.version}. The version is pinned, so results stay the same until the page is updated.`,
        },
        options.faq,
        {
          q: "Why was my program stopped?",
          a: "Programs that run longer than the time limit, use too much memory or print too much are stopped to keep the service fair. The result tells you which limit was reached.",
        },
      ],
      examples: [{ label: "Hello with input", text: language.starter, secondary: "Ada" }],
      relatedToolIds: relatedIds(definitionKey),
    },
  } as const satisfies ToolSpec;
}
