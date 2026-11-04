import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const isoDefinition = await toolSpec("iso-date-converter");
import { run as iso } from "./run.ts";

const context = (definition, text = "", settings = {}, secondary = "") => ({
  input: { text, secondary, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

test("ISO defaults show one instant consistently across all displayed formats", () => {
  assert.equal(
    iso(context(isoDefinition, "2026-07-22T12:30:00+05:30")).text,
    "ISO: 2026-07-22T07:00:00.000Z\nUTC: Wed, 22 Jul 2026 07:00:00 GMT\nLocal: 7/22/2026, 7:00:00 AM\nUnix: 1784703600",
  );
});

test("ISO local and UTC displays differ in a non-UTC host without changing the instant", () => {
  // Start a separate process because changing TZ in a Vitest worker does not
  // reliably change the native Date/Intl timezone.
  const script = `import { run } from ${JSON.stringify(new URL("./run.ts", import.meta.url).href)};
    const values = ["local", "utc"].map(displayTimezone => run({
      input: { text: "2024-07-01T00:30:00Z" },
      settings: { locale: "en-GB", displayTimezone, showUtc: false }
    }).text);
    process.stdout.write(JSON.stringify(values));`;
  const results = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: "America/New_York" },
      encoding: "utf8",
      timeout: 5000,
    }),
  );
  assert.deepEqual(results, [
    "ISO: 2024-07-01T00:30:00.000Z\nLocal: 30/06/2024, 20:30:00\nUnix: 1719793800",
    "ISO: 2024-07-01T00:30:00.000Z\nDisplay (UTC): 01/07/2024, 00:30:00\nUnix: 1719793800",
  ]);
});

for (const [locale, readable] of [
  ["en-US", "7/22/2026, 7:00:00 AM"],
  ["en-GB", "22/07/2026, 07:00:00"],
]) {
  for (const displayTimezone of ["local", "utc"]) {
    test(`ISO ${locale} ${displayTimezone} display honors omitted RFC line and preserved offset`, () => {
      assert.equal(
        iso(
          context(isoDefinition, "2026-07-22T12:30:00+0530", {
            locale,
            displayTimezone,
            showUtc: false,
            preserveOffset: true,
          }),
        ).text,
        `ISO: 2026-07-22T12:30:00.000+05:30\n${displayTimezone === "utc" ? "Display (UTC)" : "Local"}: ${readable}\nUnix: 1784703600`,
      );
    });
  }
}

for (const [input, expected] of [
  ["2024-01-01T23:00:00-02:00", "2024-01-01T23:00:00.000-02:00"],
  ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00.000Z"],
  ["0", "1970-01-01T00:00:00.000Z"],
  ["-0.001", "1969-12-31T23:59:59.999Z"],
]) {
  test(`ISO preserves valid offsets and normalizes unzoned input ${input}`, () => {
    assert.equal(iso(context(isoDefinition, input, { preserveOffset: true })).text.split("\n")[0], `ISO: ${expected}`);
  });
}

test("ISO batches retain labels and per-item errors rather than losing valid items", () => {
  const result = iso(
    context(isoDefinition, "0\r\n \r\n invalid \r\n1704067200000", { displayTimezone: "utc", showUtc: false }),
  );
  assert.deepEqual(result.labels, ["0", "invalid", "1704067200000"]);
  assert.deepEqual(result.items, [
    "ISO: 1970-01-01T00:00:00.000Z\nDisplay (UTC): 1/1/1970, 12:00:00 AM\nUnix: 0",
    "Error: Date input is not a valid date or timestamp.",
    "ISO: 2024-01-01T00:00:00.000Z\nDisplay (UTC): 1/1/2024, 12:00:00 AM\nUnix: 1704067200",
  ]);
});

for (const [text, code] of [
  ["", "input-required"],
  [" \n ", "input-required"],
  ["bad-date", "invalid-date"],
  ["2024-01-01T00:00:00+25:00", "invalid-date"],
]) {
  test(`ISO rejects ${JSON.stringify(text)}`, () => assert.throws(() => iso(context(isoDefinition, text)), { code }));
}
