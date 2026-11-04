import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test, afterEach, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const timestampDefinition = await toolSpec("timestamp-converter");
import { run as timestamp } from "./run.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

afterEach(() => vi.restoreAllMocks());

test("timestamp defaults preserve exact UTC/local labels, units, and epoch", () => {
  assert.equal(
    timestamp(context(timestampDefinition, "1704067200")).text,
    "ISO: 2024-01-01T00:00:00.000Z\nUTC: Mon, 01 Jan 2024 00:00:00 GMT\nLocal: 1/1/2024, 12:00:00 AM\nUnix seconds: 1704067200\nUnix milliseconds: 1704067200000",
  );
});

test("timestamp local output observes winter/summer offsets and can explicitly display UTC", () => {
  const script = `import { run } from ${JSON.stringify(new URL("./run.ts", import.meta.url).href)};
    const values = ["2024-01-01T00:30:00Z", "2024-07-01T00:30:00Z"].flatMap(text =>
      [true, false].map(useLocalTimezone => run({
        input: { text }, settings: { outputTimezone: "local", useLocalTimezone, twentyFourHour: true }
      }).text));
    process.stdout.write(JSON.stringify(values));`;
  const results = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: "America/New_York" },
      encoding: "utf8",
      timeout: 5000,
    }),
  );
  assert.deepEqual(results, [
    "Local: 12/31/2023, 19:30:00\nUnix seconds: 1704069000\nUnix milliseconds: 1704069000000",
    "Locale (UTC): 1/1/2024, 00:30:00\nUnix seconds: 1704069000\nUnix milliseconds: 1704069000000",
    "Local: 6/30/2024, 20:30:00\nUnix seconds: 1719793800\nUnix milliseconds: 1719793800000",
    "Locale (UTC): 7/1/2024, 00:30:00\nUnix seconds: 1719793800\nUnix milliseconds: 1719793800000",
  ]);
});

for (const [input, inputUnit, expected] of [
  ["0", "auto", "1970-01-01T00:00:00.000Z"],
  ["-1", "auto", "1969-12-31T23:59:59.000Z"],
  ["1.25", "seconds", "1970-01-01T00:00:01.250Z"],
  ["1000", "seconds", "1970-01-01T00:16:40.000Z"],
  ["1000", "milliseconds", "1970-01-01T00:00:01.000Z"],
  ["1704067200000", "auto", "2024-01-01T00:00:00.000Z"],
  ["100000000000", "auto", "1973-03-03T09:46:40.000Z"],
  ["99999999999", "auto", "5138-11-16T09:46:39.000Z"],
  ["2024-01-01T05:30:00+05:30", "milliseconds", "2024-01-01T00:00:00.000Z"],
]) {
  test(`timestamp ${inputUnit} interprets ${input} without losing the instant`, () => {
    const result = timestamp(context(timestampDefinition, input, { inputUnit, outputTimezone: "utc" }));
    assert.equal(result.text.split("\n")[0], `ISO: ${expected}`);
  });
}

for (const [outputTimezone, useLocalTimezone, twentyFourHour, expected] of [
  [
    "utc",
    true,
    false,
    "ISO: 1970-01-01T00:00:00.000Z\nUTC: Thu, 01 Jan 1970 00:00:00 GMT\nUnix seconds: 0\nUnix milliseconds: 0",
  ],
  ["local", true, false, "Local: 1/1/1970, 12:00:00 AM\nUnix seconds: 0\nUnix milliseconds: 0"],
  ["local", true, true, "Local: 1/1/1970, 00:00:00\nUnix seconds: 0\nUnix milliseconds: 0"],
  ["local", false, false, "Locale (UTC): 1/1/1970, 12:00:00 AM\nUnix seconds: 0\nUnix milliseconds: 0"],
  ["local", false, true, "Locale (UTC): 1/1/1970, 00:00:00\nUnix seconds: 0\nUnix milliseconds: 0"],
]) {
  test(`timestamp display ${outputTimezone}, local=${useLocalTimezone}, 24h=${twentyFourHour}`, () => {
    assert.equal(
      timestamp(context(timestampDefinition, "0", { outputTimezone, useLocalTimezone, twentyFourHour })).text,
      expected,
    );
  });
}

for (const [delta, expected] of [
  [-31_536_000, "1 year ago"],
  [-2_592_000, "1 month ago"],
  [-86_400, "1 day ago"],
  [-3_600, "1 hour ago"],
  [-60, "1 minute ago"],
  [-1, "1 second ago"],
  [0, "in 0 seconds"],
  [59, "in 59 seconds"],
  [60, "in 1 minute"],
  [3_600, "in 1 hour"],
  [86_400, "in 1 day"],
  [2_592_000, "in 1 month"],
  [31_536_000, "in 1 year"],
]) {
  test(`timestamp relative time uses the controlled clock (${delta}s)`, () => {
    vi.spyOn(Date, "now").mockReturnValue(1_704_067_200_000);
    const result = timestamp(
      context(timestampDefinition, String(1_704_067_200 + delta), { includeRelativeTime: true }),
    );
    assert.equal(result.text.split("\n").at(-1), `Relative: ${expected}`);
  });
}

test("timestamp batches keep successful lines and identify original invalid line numbers", () => {
  const result = timestamp(context(timestampDefinition, "0\r\n\r\nnot-a-date\r\n-1", { outputTimezone: "utc" }));
  assert.equal(result.render, "list");
  assert.deepEqual(result.items, [
    "0 → ISO: 1970-01-01T00:00:00.000Z · UTC: Thu, 01 Jan 1970 00:00:00 GMT · Unix seconds: 0 · Unix milliseconds: 0",
    "-1 → ISO: 1969-12-31T23:59:59.000Z · UTC: Wed, 31 Dec 1969 23:59:59 GMT · Unix seconds: -1 · Unix milliseconds: -1000",
  ]);
  assert.deepEqual(result.issues, [
    {
      line: 3,
      target: "input",
      message: '"not-a-date": Timestamp or date is not a valid date or timestamp.',
      messageRef: { key: "errors.batch-invalid-date", values: { input: "not-a-date" } },
    },
  ]);
  const invalid = timestamp(context(timestampDefinition, "bad\ninvalid"));
  assert.deepEqual(invalid.items, []);
  assert.equal(invalid.issues.length, 2);
});

for (const [text, code] of [
  ["", "input-required"],
  [" \n ", "input-required"],
  ["not-a-date", "invalid-date"],
  ["999999999999999999", "invalid-date"],
]) {
  test(`timestamp rejects ${JSON.stringify(text)}`, () => {
    assert.throws(() => timestamp(context(timestampDefinition, text)), { code });
  });
}
