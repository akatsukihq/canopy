import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const cronDefinition = await toolSpec("cron-builder");
import { run as buildCron } from "./run.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

test("cron builder defaults carry the exact expression, description, and artifact metadata", () => {
  const result = buildCron(context(cronDefinition));
  assert.deepEqual(result, {
    render: "text",
    text: "0 9 * * 1-5\nAt 09:00, Monday through Friday.",
    downloadName: "cron-schedule.txt",
  });
});

for (const [field, value, expression] of [
  ["minute", "59", "59 9 * * 1-5"],
  ["hour", "23", "0 23 * * 1-5"],
  ["dayOfMonth", "31", "0 9 31 * 1-5"],
  ["month", "12", "0 9 * 12 1-5"],
  ["dayOfWeek", "7", "0 9 * * 7"],
]) {
  test(`cron builder accepts the upper bound ${field}=${value}`, () => {
    const built = buildCron(context(cronDefinition, "", { [field]: value }));
    assert.equal(built.text.split("\n")[0], expression);
  });
}

for (const [field, value] of [
  ["minute", ""],
  ["minute", "60"],
  ["hour", "24"],
  ["dayOfMonth", "0"],
  ["month", "13"],
  ["dayOfWeek", "8"],
]) {
  test(`cron builder rejects invalid ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(() => buildCron(context(cronDefinition, "", { [field]: value })), { code: "invalid-cron" });
  });
}
