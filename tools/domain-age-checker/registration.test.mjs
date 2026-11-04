import { afterEach, expect, test, vi } from "vitest";

import { run } from "./run.ts";
import { createDomainSummary } from "./preview.ts";
import definition from "./definition.ts";
import { createTranslator } from "next-intl";
import { extractToolMessages, formatToolMessage, toolMessageTree } from "../../lib/tool-framework/translations.ts";

const english = (key, values) => formatToolMessage("en", definition.messages[key] ?? key, values);
const summaryOf = (raw, now = Date.now()) => createDomainSummary(raw, now, english);

afterEach(() => vi.unstubAllGlobals());

function lookup(data, settings = {}) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(data)));
  return run({
    input: { text: "https://www.example.com/path" },
    settings,
    signal: new AbortController().signal,
  });
}

test("domain-age-checker preserves its exact raw registration JSON", async () => {
  const result = await lookup({
    ldhName: "EXAMPLE.COM",
    events: [
      { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
      { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
      { eventAction: "last changed", eventDate: "2026-08-14T07:01:02Z" },
    ],
    status: ["client transfer prohibited"],
    nameservers: [{ ldhName: "NS1.EXAMPLE.COM" }, { ldhName: "NS2.EXAMPLE.COM" }],
  });
  const expected = {
    domain: "EXAMPLE.COM",
    registered: "1995-08-14T04:00:00Z",
    expires: "2027-08-13T04:00:00Z",
    updated: "2026-08-14T07:01:02Z",
    status: ["client transfer prohibited"],
    nameservers: ["NS1.EXAMPLE.COM", "NS2.EXAMPLE.COM"],
  };

  expect(result.render).toBe("text");
  expect(result.text).toBe(JSON.stringify(expected, null, 2));
  expect(summaryOf(result.text).domain).toBe("EXAMPLE.COM");
});

test("domain-age-checker applies date visibility settings to both result views", async () => {
  for (const showRegistrationDate of [false, true]) {
    for (const showExpiryDate of [false, true]) {
      const result = await lookup(
        {
          events: [
            { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
            { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
          ],
        },
        { showRegistrationDate, showExpiryDate },
      );
      const expected = {
        domain: "example.com",
        ...(showRegistrationDate ? { registered: "1995-08-14T04:00:00Z" } : {}),
        ...(showExpiryDate ? { expires: "2027-08-13T04:00:00Z" } : {}),
        updated: null,
        status: [],
        nameservers: [],
      };

      expect(JSON.parse(result.text)).toEqual(expected);
      const summary = summaryOf(result.text);
      expect(summary.dates.some(({ label }) => label === "Registered")).toBe(showRegistrationDate);
      expect(summary.dates.some(({ label }) => label === "Reported expiry")).toBe(showExpiryDate);
      if (!showRegistrationDate) {
        expect(summary.age).toBe("Age unavailable");
        expect(summary.ageDetail).toContain("hidden");
        expect(JSON.stringify(summary)).not.toContain("1995");
      }
    }
  }
});

test("domain-age-checker keeps sparse and malformed registry fields consistent across views", async () => {
  for (const [data, nameservers] of [
    [{}, []],
    [{ events: "unavailable", nameservers: { ldhName: "NS1.EXAMPLE.COM" } }, []],
    [
      {
        events: [null, "invalid", { eventAction: "registration" }],
        nameservers: [null, "invalid", [], {}, { ldhName: 42 }, { ldhName: "NS1.EXAMPLE.COM" }],
      },
      ["NS1.EXAMPLE.COM"],
    ],
  ]) {
    const result = await lookup(data);
    const expected = {
      domain: "example.com",
      registered: null,
      expires: null,
      updated: null,
      status: [],
      nameservers,
    };

    expect(JSON.parse(result.text)).toEqual(expected);
    const summary = summaryOf(result.text);
    expect(summary.age).toBe("Age unavailable");
    expect(summary.dates.map(({ value }) => value)).toEqual(["Not reported", "Not reported", "Not reported"]);
    expect(summary.nameservers).toEqual(nameservers);
  }
});

const NOW = Date.parse("2026-09-25T12:00:00Z");

function summarize(record, now = NOW) {
  return summaryOf(JSON.stringify(record), now);
}

test("domain summary leads with a readable current age and dates in UTC", () => {
  const summary = summarize({
    domain: "PARK.COM",
    registered: "1995-04-11T04:00:00Z",
    expires: "2028-06-16T03:59:59Z",
    updated: "2026-08-07T16:39:15Z",
  });

  expect(summary.age).toBe("31 years, 167 days old");
  expect(summary.ageDetail).toContain("current registration");
  expect(summary.ageDetail).toContain("UTC");
  expect(summary.dates.map(({ label }) => label)).toEqual(["Registered", "Reported expiry", "Last record update"]);
  expect(summary.dates[0].value).toBe("11 April 1995 at 04:00 UTC");
  expect(summary.dates[1].detail).toContain("registrar");
});

test("domain age handles complete years, leap anniversaries, and short registrations", () => {
  for (const [registered, now, age] of [
    ["2025-09-25T12:00:00Z", "2026-09-25T11:59:59Z", "364 days old"],
    ["2025-09-25T12:00:00Z", "2026-09-25T12:00:00Z", "1 year old"],
    ["2024-02-29T12:00:00Z", "2025-02-28T11:59:59Z", "364 days old"],
    ["2024-02-29T12:00:00Z", "2025-02-28T12:00:00Z", "1 year old"],
    ["2024-02-29T12:00:00Z", "2025-03-01T12:00:00Z", "1 year, 1 day old"],
    ["2026-09-25T01:00:00Z", "2026-09-25T12:00:00Z", "Less than a day old"],
    ["2026-09-24T12:00:00Z", "2026-09-25T12:00:00Z", "1 day old"],
  ]) {
    expect(summarize({ registered }, Date.parse(now)).age).toBe(age);
  }
});

test("domain summary explains missing, invalid, and future dates without inventing ages", () => {
  for (const registered of [null, {}, 0, "", "yesterday", "2026-02-30T00:00:00Z", "2026-09-25T00:00:00"]) {
    const summary = summarize({ registered });
    expect(summary.age).toBe("Age unavailable");
    expect(summary.dates[0].value).toBe(registered == null || registered === "" ? "Not reported" : "Date unavailable");
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Invalid Date/);
  }
  const future = summarize({ registered: "2027-01-01T00:00:00Z" });
  expect(future.age).toBe("Age unavailable");
  expect(future.ageDetail).toContain("future");
});

test("domain summary converts timezone offsets without changing the reported instant", () => {
  const summary = summarize({ registered: "2025-09-26T00:30:00+05:30" });
  expect(summary.dates[0].value).toBe("25 September 2025 at 19:00 UTC");
  expect(summary.age).toBe("364 days old");
});

test("expiry explains elapsed and imminent dates without claiming availability", () => {
  const expired = summarize({ expires: "2026-09-24T12:00:00Z" }).dates[0];
  expect(expired.detail).toContain("has passed");
  expect(expired.detail).toContain("registrar");
  expect(expired.detail).toContain("does not mean the domain is available");
  const soon = summarize({ expires: "2026-09-25T13:00:00Z" }).dates[0];
  expect(soon.detail).toContain("next 24 hours");
});

test("statuses explain both RDAP and EPP codes in ordinary language", () => {
  const summary = summarize({
    status: [
      "client transfer prohibited",
      "serverDeleteProhibited",
      "clientUpdateProhibited",
      "client hold",
      "redemptionPeriod",
      "pendingDelete",
      "active",
      "vendorStatus",
    ],
  });
  expect(summary.statuses.map(({ label }) => label)).toEqual([
    "Transfer locked",
    "Deletion locked",
    "Changes locked",
    "DNS suspended",
    "Recovery period",
    "Deletion requested",
    "No restrictions reported",
    "Vendor status",
  ]);
  expect(summary.statuses[0].detail).toContain("registrar");
  expect(summary.statuses[1].detail).toContain("registry");
  expect(summary.statuses[5].detail).toContain("recovery options");
  expect(summary.statuses[5].detail).not.toMatch(/cannot|irreversible|available/);
  expect(summary.statuses[6].detail).toContain("does not confirm");
  expect(summary.statuses[7].detail).toContain("Raw");
});

test("malformed records and unexpected fields cannot become objects or code in the preview", () => {
  for (const raw of ["bad json", "null", "42", "[]", '"example.com"']) {
    const summary = summaryOf(raw, NOW);
    expect(summary.domain).toBe("Domain not reported");
    expect(summary.age).toBe("Age unavailable");
    expect(summary.ageDetail).toContain("could not be read");
  }
  const summary = summarize({
    domain: { name: "wrong" },
    status: [null, {}, 99, "", "clientTransferProhibited", "client transfer prohibited"],
    nameservers: [null, {}, 99, "", "NS1.EXAMPLE.COM", "NS1.EXAMPLE.COM"],
  });
  expect(summary.domain).toBe("Domain not reported");
  expect(summary.statuses).toHaveLength(1);
  expect(summary.nameservers).toEqual(["NS1.EXAMPLE.COM"]);
});

test("domain summary localizes explanatory text and dates without changing registry data", () => {
  const messages = toolMessageTree({
    ...extractToolMessages(definition),
    "runtime.workspace.summary.ageYears": "{years, plural, one {# an} other {# ans}}",
    "runtime.workspace.summary.registered": "Enregistré",
  });
  const translate = createTranslator({ locale: "fr", messages, namespace: "runtime" });
  const summary = createDomainSummary(
    JSON.stringify({
      domain: "EXAMPLE.COM",
      registered: "2020-02-20T12:00:00Z",
      nameservers: ["NS1.EXAMPLE.COM"],
    }),
    Date.parse("2021-02-20T12:00:00Z"),
    translate,
    "fr",
  );
  expect(summary.age).toBe("1 an");
  expect(summary.dates[0].label).toBe("Enregistré");
  expect(summary.dates[0].value).toContain("février");
  expect(summary.domain).toBe("EXAMPLE.COM");
  expect(summary.nameservers).toEqual(["NS1.EXAMPLE.COM"]);
});
