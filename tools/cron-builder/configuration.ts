import { ToolError } from "../../lib/tool-framework/run.ts";
import type { CronTranslator } from "../../lib/devtools/shared/cron-messages.ts";
import { describeCron } from "../../lib/devtools/shared/datetime.ts";

export const CRON_FIELDS = [
  { key: "minute", range: "0–59" },
  { key: "hour", range: "0–23" },
  { key: "dayOfMonth", range: "1–31" },
  { key: "month", range: "1–12" },
  { key: "dayOfWeek", range: "0–7 · Sun = 0 or 7" },
] as const;

type CronField = (typeof CRON_FIELDS)[number]["key"];

export function getCronFieldError(
  key: CronField,
  value: string,
  text?: CronTranslator,
  label: string = key,
): string | undefined {
  if (!value.trim())
    return text
      ? text("workspace.enterField", { field: label })
      : `Enter ${label.toLowerCase()}, or * for every value.`;
  const fields = CRON_FIELDS.map((field) => (field.key === key ? value.trim() : "*"));
  try {
    describeCron(fields.join(" "));
    return undefined;
  } catch (error) {
    if (!text) return error instanceof Error ? error.message : "Enter a valid cron value.";
    const message = error instanceof ToolError ? error.details?.messageRef : undefined;
    return message ? text(message.key, message.values) : text("workspace.fieldSyntax", { field: label });
  }
}

/** Display-only summary. Execution and the exported result remain owned by run.ts. */
export function getScheduleSummary(
  settings: Readonly<Record<string, unknown>>,
  text?: CronTranslator,
  locale?: string,
): string {
  const fields = CRON_FIELDS.map(({ key }) => String(settings[key] ?? "*").trim());
  const [minute, hour, day, month, weekday] = fields;
  let description: string;
  try {
    description = describeCron(fields.join(" "), text ? { translate: text, locale } : undefined);
  } catch {
    return text?.("workspace.completeFields") ?? "Complete the highlighted fields to see your schedule.";
  }
  if (day === "*" && month === "*") {
    if (weekday === "*" && hour === "*") {
      if (minute === "*" || minute === "*/1") return text?.("workspace.everyMinute") ?? "Every minute.";
      if (/^\*\/\d+$/.test(minute) && 60 % Number(minute.slice(2)) === 0) {
        return (
          text?.("workspace.everyMinutes", { count: Number(minute.slice(2)) }) ??
          `Every ${Number(minute.slice(2))} minutes.`
        );
      }
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && (weekday === "*" || weekday === "1-5")) {
      const time = `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
      return (
        text?.(weekday === "1-5" ? "workspace.weekdayTime" : "workspace.dailyTime", { time }) ??
        `At ${time}, ${weekday === "1-5" ? "Monday through Friday" : "every day"}.`
      );
    }
  }
  return description;
}
