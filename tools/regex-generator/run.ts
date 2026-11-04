/**
 * Moved verbatim from the `regex-generator` case in
 * `lib/devtools/format-json.ts`: the same six patterns, character for
 * character, and the same per-language literal wrapping and delimiter escaping.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly preset: string;
  readonly language: string;
  readonly flags: string;
  readonly addNamedGroups: boolean;
  readonly multiline: boolean;
  readonly explain: boolean;
};

const PATTERNS: Readonly<Record<string, string>> = {
  email: "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+",
  url: "https?://(?:www\\.)?[-A-Za-z0-9@:%._+~#=]{1,256}\\.[A-Za-z0-9()]{1,63}\\b(?:[-A-Za-z0-9()@:%_+.~#?&/=]*)",
  ipv4: "(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)",
  uuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
  "hex-color": "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b",
  password: "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{12,}",
};

const EXPLANATIONS: Readonly<Record<string, string>> = {
  email: "Matches a practical email-address shape.",
  url: "Matches an HTTP or HTTPS URL.",
  ipv4: "Matches an IPv4 address with valid octets.",
  uuid: "Matches an RFC 4122 variant UUID.",
  "hex-color": "Matches a three, six, or eight-digit hex color.",
  password: "Matches a strong password of at least 12 characters.",
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  let pattern = PATTERNS[ctx.settings.preset];
  if (!pattern) {
    throw new ToolError("preset-invalid", "Regex preset is invalid.", "Choose one of the listed presets.", {
      messageRef: { key: "errors.preset-invalid" },
      recoveryMessage: { key: "recovery.preset-invalid" },
    });
  }
  const { addNamedGroups, explain, flags, language, multiline } = ctx.settings;
  if (addNamedGroups) {
    pattern = language === "python" ? `(?P<match>${pattern})` : `(?<match>${pattern})`;
  }
  const global = flags.includes("global");
  const modifiers = `${flags.includes("ignore-case") ? "i" : ""}${multiline ? "m" : ""}`;
  const literal =
    language === "javascript"
      ? `/${pattern.replace(/\//g, "\\/")}/${global ? "g" : ""}${modifiers}`
      : language === "python"
        ? global
          ? `re.findall(r"${modifiers ? `(?${modifiers}:${pattern})` : pattern}", text)`
          : `r"${modifiers ? `(?${modifiers}:${pattern})` : pattern}"`
        : global
          ? `preg_match_all("~${pattern.replace(/~/g, "\\~")}~${modifiers}", $text, $matches)`
          : `~${pattern.replace(/~/g, "\\~")}~${modifiers}`;
  return {
    render: "text",
    text: explain ? `${language === "python" ? "#" : "//"} ${EXPLANATIONS[ctx.settings.preset]}\n${literal}` : literal,
  };
};

export default run;
