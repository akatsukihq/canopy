/**
 * Moved from the `timestamp-converter` case in `lib/devtools/format-json.ts`
 * (line 2764), with one deliberate change.
 *
 * DELIBERATE FIX — host-locale dependence. The original called
 * `date.toLocaleString()` with no locale argument, so the "Local:" line was
 * whatever the host's default locale produced: "1/1/2024, 12:00:00 am" under
 * en_IN, "1/1/2024, 12:00:00 AM" under en_US. The same input produced different
 * output on different machines, which is a bug in a tool whose whole job is
 * turning one instant into canonical strings — and it is untestable, since a
 * process's locale cannot be pinned the way `TZ` can.
 *
 * The locale is now pinned to "en-US". The time zone is still the host's, which
 * is the point of the line. `tools/timestamp-converter/fixtures.json` was
 * updated from "12:00:00 am" to "12:00:00 AM" to match.
 *
 * `parseDate` (shared) still decides seconds-versus-milliseconds by magnitude,
 * unchanged.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { parseDate } from "../../lib/devtools/shared/datetime.ts";

const DISPLAY_LOCALE = "en-US";
const NUMERIC_TIMESTAMP = /^-?\d+(?:\.\d+)?$/;
const RELATIVE_UNITS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
] as const;

type Settings = {
  readonly inputUnit: string;
  readonly outputTimezone: string;
  readonly useLocalTimezone: boolean;
  readonly includeRelativeTime: boolean;
  readonly twentyFourHour: boolean;
};

function inputDate(input: string, unit: Settings["inputUnit"]): Date {
  if (unit === "auto" || !NUMERIC_TIMESTAMP.test(input.trim())) {
    return parseDate(input, "Timestamp or date");
  }
  const value = Number(input);
  const date = new Date(unit === "seconds" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) {
    throw new ToolError("invalid-date", "Timestamp or date is not a valid date or timestamp.", undefined, {
      messageRef: { key: "errors.invalid-date" },
    });
  }
  return date;
}

function relativeTime(date: Date): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const [unit, secondsPerUnit] = RELATIVE_UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? RELATIVE_UNITS.at(-1)!;
  return new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { numeric: "always" }).format(
    Math.round(seconds / secondsPerUnit),
    unit,
  );
}

function convertTimestamp(input: string, settings: Settings): string {
  const date = inputDate(input, settings.inputUnit ?? "auto");
  const outputTimezone = settings.outputTimezone ?? "local-and-utc";
  const useLocalTimezone = settings.useLocalTimezone ?? true;
  const localOptions = settings.twentyFourHour
    ? { hour12: false, ...(useLocalTimezone ? {} : { timeZone: "UTC" }) }
    : useLocalTimezone
      ? undefined
      : { timeZone: "UTC" };
  const lines = [];
  if (outputTimezone !== "local") {
    lines.push(`ISO: ${date.toISOString()}`, `UTC: ${date.toUTCString()}`);
  }
  if (outputTimezone !== "utc") {
    lines.push(`${useLocalTimezone ? "Local" : "Locale (UTC)"}: ${date.toLocaleString(DISPLAY_LOCALE, localOptions)}`);
  }
  lines.push(`Unix seconds: ${Math.floor(date.getTime() / 1000)}`, `Unix milliseconds: ${date.getTime()}`);
  if (settings.includeRelativeTime) {
    lines.push(`Relative: ${relativeTime(date)}`);
  }
  return lines.join("\n");
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const inputs = ctx.input.text
    .split(/\r?\n/)
    .map((input, index) => ({ input: input.trim(), line: index + 1 }))
    .filter(({ input }) => input);
  if (inputs.length <= 1) {
    return { render: "text", text: convertTimestamp(inputs[0]?.input ?? "", ctx.settings) };
  }

  const items: string[] = [];
  const issues: NonNullable<ToolResult["issues"]>[number][] = [];
  for (const input of inputs) {
    try {
      items.push(`${input.input} → ${convertTimestamp(input.input, ctx.settings).replaceAll("\n", " · ")}`);
    } catch (error) {
      issues.push({
        line: input.line,
        message: `"${input.input}": ${error instanceof Error ? error.message : "Conversion failed."}`,
        messageRef:
          error instanceof ToolError && error.code === "invalid-date"
            ? { key: "errors.batch-invalid-date", values: { input: input.input } }
            : error instanceof ToolError && error.details?.messageRef
              ? error.details.messageRef
              : { key: "errors.batch-conversion", values: { input: input.input } },
        target: "input",
      });
    }
  }
  return {
    render: "list",
    items,
    issues: issues.length ? issues : undefined,
  };
};

export default run;
