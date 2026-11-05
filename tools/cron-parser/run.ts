import { describeCronSchedule } from "../../lib/devtools/shared/datetime.ts";
import { ToolError } from "../../lib/tool-framework/run.ts";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const expression = ctx.input.text.trim();
  if (!expression)
    throw new ToolError("input-required", "Cron expression is required.", "Enter a value and try again.", {
      messageRef: { key: "cron.error.required" },
      recoveryMessage: { key: "cron.error.enterValue" },
    });
  const schedule = describeCronSchedule(expression);
  const notes = [
    ...schedule.notes,
    "Times use the timezone configured in your scheduler. The expression itself does not include a timezone.",
  ];
  return {
    render: "text",
    text: [
      schedule.description,
      `Cron expression: ${expression}`,
      `What each part means:\n${schedule.fields.map((field) => `${field.label} (${field.value}): ${field.description}`).join("\n")}`,
      ...notes,
    ].join("\n\n"),
    verdict: {
      level: "ok",
      label: "Valid schedule",
      labelMessage: { key: "cron.validSchedule" },
      detail: schedule.description,
    },
    sections: [
      {
        title: "Cron expression",
        titleMessage: { key: "cron.expression" },
        body: { render: "code", code: expression, language: "crontab" },
      },
      {
        title: "What each part means",
        titleMessage: { key: "cron.fieldMeanings" },
        body: {
          render: "table",
          columns: ["Part", "Value", "Meaning"],
          columnMessages: ["part", "value", "meaning"].map((key) => ({ key: `cron.column.${key}` })),
          rows: schedule.fields.map((field) => [field.label, field.value, field.description]),
          rowMessages: ["minute", "hour", "day", "month", "weekday"].map((key) => [
            { key: `cron.field.${key}` },
            undefined,
            undefined,
          ]),
        },
      },
      { title: "Timing notes", titleMessage: { key: "cron.timingNotes" }, body: { render: "list", items: notes } },
    ],
  };
};

export default run;
