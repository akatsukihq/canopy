import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("cron-parser");
import { run } from "./run.ts";
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

function Fixture({ result = null, error, disabled = false, onInputChange = () => {} }) {
  const [input, setInput] = useState({ text: "*/15 * * * *", files: [] });
  return React.createElement(Workspace, {
    spec: definition,
    input,
    settings: {},
    result,
    error,
    disabled,
    lifecycle: error ? "failed" : result ? "completed" : "ready",
    onInputChange(next) {
      setInput(next);
      onInputChange(next);
    },
    onSettingChange() {},
  });
}

test("cron parser displays the actual field meanings and copies only the expression from its dedicated action", async () => {
  const result = run({ input: { text: "*/15 * * * *" }, settings: {} });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { container } = await mountTool(React.createElement(Fixture, { result }), { spec: definition });
  assert.ok(container.textContent.includes("Every 15 minutes, every day."));
  assert.equal(container.querySelectorAll("tbody tr").length, 5);
  assert.ok(container.textContent.includes("timezone configured in your scheduler"));
  await click(button("Copy cron expression"));
  assert.deepEqual(writeText.mock.calls, [["*/15 * * * *"]]);
});

test("cron parser input is editable before a manual result and remains accessible on failure", async () => {
  const onInputChange = vi.fn();
  const view = await mountTool(React.createElement(Fixture, { onInputChange }), { spec: definition });
  await fill(field(/^Cron expression/), "60 * * * *");
  assert.equal(onInputChange.mock.calls.at(-1)[0].text, "60 * * * *");
  await view.rerender(React.createElement(Fixture, { error: "Minute must be between 0 and 59.", onInputChange }));
  assert.ok(view.container.textContent.includes("Minute must be between 0 and 59."));
  await fill(field(/^Cron expression/), "0 9 * * 1-5");
  const result = run({ input: onInputChange.mock.calls.at(-1)[0], settings: {} });
  await view.rerender(React.createElement(Fixture, { result, onInputChange }));
  assert.ok(view.container.textContent.includes("At 09:00, Monday through Friday."));
  assert.ok(!view.container.textContent.includes("Minute must be between 0 and 59."));
});

test("cron parser localizes the headline, field explanations and notes while copying canonical output", async () => {
  const result = run({ input: { text: "*/15 * * * *" }, settings: {} });
  const original = structuredClone(result);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { container } = await mountTool(React.createElement(Fixture, { result }), {
    spec: definition,
    locale: "fr",
    messages: {
      "runtime.cron.timing.minuteStep": "Toutes les {count, plural, one {minute} other {# minutes}}",
      "runtime.cron.calendar.everyDay": "chaque jour",
      "runtime.cron.expression": "Expression cron",
      "runtime.cron.validSchedule": "Planification valide",
      "runtime.cron.fieldMeanings": "Signification des champs",
      "runtime.cron.field.minute": "Minute traduite",
      "runtime.cron.column.meaning": "Signification",
      "runtime.cron.note.timezone": "Le fuseau horaire est configuré dans votre planificateur.",
      "runtime.cron.field.minutesPast": "{minutes} {unitCount, plural, one {minute} other {minutes}} après l’heure.",
      "runtime.cron.range": "{start} à {end}",
      "runtime.workspace.copy_cron_expression_a3078a": "Copier l’expression cron",
    },
  });
  assert.ok(container.textContent.includes("Toutes les 15 minutes, chaque jour."));
  assert.ok(container.textContent.includes("Signification des champs"));
  assert.ok(container.textContent.includes("Minute traduite"));
  assert.ok(container.textContent.includes("0, 15, 30 et 45 minutes après l’heure."));
  assert.ok(container.textContent.includes("Le fuseau horaire est configuré dans votre planificateur."));
  assert.ok(!container.textContent.includes("Every 15 minutes, every day."));
  await click(button("Copier l’expression cron"));
  assert.deepEqual(writeText.mock.calls, [["*/15 * * * *"]]);
  assert.deepEqual(result, original);
});
