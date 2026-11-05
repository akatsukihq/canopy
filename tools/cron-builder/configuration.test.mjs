import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
const { test } = await import(process.env.VITEST ? "vitest" : "node:test");

import { getCronFieldError, getScheduleSummary } from "./configuration.ts";
const definition = await toolSpec("cron-builder");
import { run } from "./run.ts";

const defaults = Object.fromEntries(
  Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default]),
);

test("configuration describes the current schedule, not a fixed example", () => {
  assert.equal(getScheduleSummary(defaults), "At 09:00, Monday through Friday.");
  assert.equal(getScheduleSummary({ ...defaults, hour: "14", minute: "30" }), "At 14:30, Monday through Friday.");
  assert.equal(getScheduleSummary({ ...defaults, dayOfWeek: "*" }), "At 09:00, every day.");
  assert.equal(
    getScheduleSummary({ minute: "*/15", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" }),
    "Every 15 minutes.",
  );
});

test("steps that do not divide an hour are not described as uniform intervals", () => {
  assert.equal(
    getScheduleSummary({ ...defaults, minute: "*/45", hour: "*", dayOfWeek: "*" }),
    "At 0 and 45 minutes past every hour, every day.",
  );
});

test("complex schedules share the same plain-language parser explanation", () => {
  assert.equal(
    getScheduleSummary({ ...defaults, minute: "0,30", hour: "8-18" }),
    "At 0 and 30 minutes past the hours 08:00 through 18:00, Monday through Friday.",
  );
});

test("field feedback accepts existing cron grammar and identifies invalid or empty values", () => {
  for (const value of ["*", "*/15", "0,30", "10-20", " 0 "])
    assert.equal(getCronFieldError("minute", value), undefined);
  for (const [key, value] of [
    ["minute", "60"],
    ["hour", "24"],
    ["month", "JAN"],
    ["dayOfWeek", "MON-FRI"],
    ["minute", "5-1"],
    ["minute", "*/0"],
    ["dayOfMonth", ""],
  ]) {
    assert.ok(getCronFieldError(key, value), `${key}: ${value}`);
  }
  assert.match(getScheduleSummary({ ...defaults, minute: "60" }), /highlighted fields/);
});

test("configuration exports the explained schedule and retains download metadata", () => {
  const result = run({ settings: { ...defaults, timezone: "local", commandLabel: "Backup" } });
  assert.equal(result.text, "0 9 * * 1-5\nAt 09:00, Monday through Friday.\nTimezone: Local time\nLabel: Backup");
  assert.equal(result.downloadName, "cron-schedule.txt");
});

test("complex builder previews and field validation use explicit translated messages", async () => {
  const { createTranslator } = await import("use-intl/core");
  const { toolMessageTree } = await import("../../lib/tool-framework/translations.ts");
  const translate = createTranslator({
    locale: "fr",
    messages: toolMessageTree({
      ...definition.messages,
      "cron.timing.at": "À {times}",
      "cron.range": "{start} à {end}",
      "cron.error.range":
        "{field, select, minute {La minute} hour {L’heure} other {Le champ}} doit être entre {min} et {max}.",
    }),
  });
  assert.equal(
    getScheduleSummary({ ...defaults, dayOfWeek: "1,3,5" }, translate, "fr"),
    "À 09:00, lundi, mercredi et vendredi.",
  );
  assert.equal(getCronFieldError("minute", "60", translate), "La minute doit être entre 0 et 59.");
  assert.equal(getCronFieldError("minute", "60"), "Minute must be between 0 and 59.");
});
