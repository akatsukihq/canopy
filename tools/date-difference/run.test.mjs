import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const differenceDefinition = await toolSpec("date-difference");
import { run as difference } from "./run.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

test("local date-only inputs measure elapsed hours across both daylight saving transitions", () => {
  // TZ must be set before the process starts; mutating it in a worker does not
  // reliably update Date's timezone. No network or application server is used.
  const script = `import { run } from ${JSON.stringify(new URL("./run.ts", import.meta.url).href)};
    const scenarios = [
      ["2024-03-10", "2024-03-11", "local"],
      ["2024-11-03", "2024-11-04", "local"],
      ["2024-03-10", "2024-03-11", "utc"],
      ["2024-03-10", "2024-03-11", "as-entered"],
    ];
    process.stdout.write(JSON.stringify(scenarios.map(([text, secondary, timezone]) =>
      run({ input: { text, secondary }, settings: { timezone } }).text)));`;
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.deepEqual(JSON.parse(result), [
    "0.958 days (23 hours)",
    "1.042 days (25 hours)",
    "1 days (24 hours)",
    "1 days (24 hours)",
  ]);
});

for (const [start, end, expected] of [
  ["2024-02-28T00:00:00Z", "2024-03-01T00:00:00Z", "2 days (48 hours)"],
  ["2024-03-01T00:00:00Z", "2024-02-28T00:00:00Z", "-2 days (-48 hours)"],
  ["0", "0", "0 days (0 hours)"],
  ["0", "1", "0 days (0 hours)"],
  ["0", "3600", "0.042 days (1 hours)"],
  ["2024-03-10T00:00:00-05:00", "2024-03-11T00:00:00-04:00", "0.958 days (23 hours)"],
  ["2024-11-03T00:00:00-04:00", "2024-11-04T00:00:00-05:00", "1.042 days (25 hours)"],
]) {
  test(`date difference measures signed elapsed time ${start} to ${end}`, () => {
    assert.equal(difference(context(differenceDefinition, start, {}, end)).text, expected);
  });
}

for (const [timezone, expected] of [
  ["as-entered", "0.25 days (6 hours)"],
  ["utc", "0 days (0 hours)"],
  ["local", "0 days (0 hours)"],
]) {
  test(`date difference applies ${timezone} to explicit offsets`, () => {
    assert.equal(
      difference(context(differenceDefinition, "2024-01-01T09:00:00+02:00", { timezone }, "2024-01-01T09:00:00-04:00"))
        .text,
      expected,
    );
  });
}

test("date difference supports separate times, seconds, and days-only output", () => {
  assert.equal(
    difference(
      context(
        differenceDefinition,
        "2026-01-02",
        { startTime: "09:00", endTime: "17:30", timezone: "utc", exactDuration: false },
        "2026-01-06",
      ),
    ).text,
    "4.354 days",
  );
  assert.equal(
    difference(
      context(
        differenceDefinition,
        "2026-01-02",
        { startTime: "00:00:00", endTime: "23:59:59", timezone: "utc" },
        "2026-01-02",
      ),
    ).text,
    "1 days (24 hours)",
  );
});

for (const field of ["startTime", "endTime"]) {
  for (const time of ["24:00", "23:60", "9:00", "12:00:60", "noon"]) {
    test(`date difference rejects invalid ${field} ${time}`, () => {
      assert.throws(() => difference(context(differenceDefinition, "2024-01-01", { [field]: time }, "2024-01-02")), {
        code: "time-invalid",
      });
    });
  }
}

for (const [start, end, code] of [
  ["", "2024-01-02", "input-required"],
  ["2024-01-01", "", "input-required"],
  ["bad", "2024-01-02", "invalid-date"],
  ["2024-01-01", "bad", "invalid-date"],
]) {
  test(`date difference rejects missing/invalid endpoint ${start}/${end}`, () => {
    assert.throws(() => difference(context(differenceDefinition, start, {}, end)), { code });
  });
}
