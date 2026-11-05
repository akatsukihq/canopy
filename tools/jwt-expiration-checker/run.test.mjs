import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test, vi } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("jwt-expiration-checker");
import { run } from "./run.ts";
import { getExpirationSummary } from "./result.ts";

const NOW = 1_900_000_000.125;
const DATE_LIMIT = 8_640_000_000_000;
const jwtJson = (json) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(json).toString("base64url")}.`;
const jwt = (payload) => jwtJson(JSON.stringify(payload));
const context = (token, settings = {}) => ({
  input: { text: token, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});
const check = (payload, settings) => run(context(jwt(payload), settings));

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW * 1000));
afterEach(() => vi.restoreAllMocks());

const fixtures = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const example of fixtures.cases) {
  test(`JWT expiration preserves raw output for ${example.name}`, () => {
    const result = run(context(example.input.primary, example.settings));
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
  });
}

for (const [name, payload, settings, state] of [
  ["future expiry", { exp: NOW + 600 }, {}, "active"],
  ["expiry exactly now", { exp: NOW }, {}, "expired"],
  ["elapsed expiry wins over future nbf", { exp: NOW - 1, nbf: NOW + 20 }, {}, "expired"],
  ["future nbf with an expiry", { exp: NOW + 600, nbf: NOW + 1 }, {}, "not-active"],
  ["future nbf without an expiry", { nbf: NOW + 1 }, {}, "not-active"],
  ["nbf exactly now is active", { exp: NOW + 600, nbf: NOW }, {}, "active"],
  ["future iat does not replace nbf", { exp: NOW + 600, iat: NOW + 30 }, {}, "active"],
  ["warning boundary", { exp: NOW + 300 }, { warnBeforeExpiry: true }, "expiring-soon"],
  ["outside warning boundary", { exp: NOW + 300.001 }, { warnBeforeExpiry: true }, "active"],
  ["warning is optional", { exp: NOW + 1 }, {}, "active"],
  ["not-active takes priority over warning", { exp: NOW + 30, nbf: NOW + 1 }, { warnBeforeExpiry: true }, "not-active"],
  ["missing claims", {}, {}, "no-expiration"],
  ["elapsed nbf without expiry", { nbf: NOW - 1 }, {}, "no-expiration"],
]) {
  test(`JWT expiration reports ${name}`, () => {
    const result = check(payload, settings);
    assert.equal(result.jsonPreview?.render, "json-tree");
    assert.deepEqual(result.jsonPreview?.value, {
      state,
      checkedAt: NOW,
      expiresAt: payload.exp ?? null,
      issuedAt: payload.iat ?? null,
      notBefore: payload.nbf ?? null,
      useLocalTime: false,
    });
    assert.deepEqual(getExpirationSummary(result), result.jsonPreview.value);
    if (name === "future nbf without an expiry") assert.match(result.text, /^Status: Not active yet\n/);
  });
}

test("JWT expiration preserves fractional and pre-epoch NumericDates", () => {
  const result = check({ exp: NOW + 60.25, iat: -0.5, nbf: NOW - 0.125 });
  assert.equal(result.jsonPreview?.value.issuedAt, -0.5);
  assert.equal(result.jsonPreview?.value.expiresAt, NOW + 60.25);
  assert.match(result.text, /Issued: 1969-12-31T23:59:59.500Z/);
});

test("JWT expiration accepts both inclusive Date limits", () => {
  const result = check({ exp: DATE_LIMIT, iat: -DATE_LIMIT });
  assert.equal(result.jsonPreview?.value.expiresAt, DATE_LIMIT);
  assert.equal(result.jsonPreview?.value.issuedAt, -DATE_LIMIT);
  assert.match(result.text, /Expires: \+275760-09-13T00:00:00.000Z/);
  assert.match(result.text, /Issued: -271821-04-20T00:00:00.000Z/);
});

for (const claim of ["exp", "nbf", "iat"]) {
  test(`JWT expiration rejects invalid ${claim} values without exposing the token`, () => {
    const invalidJsonValues = [
      '"4102444800"',
      '"not-a-date"',
      "null",
      "true",
      "{}",
      "[]",
      "1e999",
      "-1e999",
      String(DATE_LIMIT + 1),
      String(-DATE_LIMIT - 1),
    ];
    for (const value of invalidJsonValues) {
      const token = jwtJson(`{"${claim}":${value},"sub":"private-subject"}`);
      assert.throws(
        () => run(context(token)),
        (error) => {
          assert.equal(error.name, "ToolError");
          assert.equal(error.code, "invalid-numeric-date");
          assert.ok(error.message.includes(claim));
          assert.ok(error.recovery);
          assert.ok(!`${error.message} ${error.recovery}`.includes("private-subject"));
          assert.ok(!`${error.message} ${error.recovery}`.includes(token));
          return true;
        },
      );
    }
  });
}

test("JWT expiration exposes payload only when decoding is requested", () => {
  const payload = { sub: "private-subject", exp: NOW + 600, iat: NOW - 60 };
  const hidden = check(payload);
  assert.equal(Object.hasOwn(hidden.jsonPreview?.value ?? {}, "payload"), false);
  assert.ok(!hidden.text.includes("private-subject"));
  const decoded = check(payload, { decodePayload: true });
  assert.deepEqual(decoded.jsonPreview?.value.payload, payload);
  assert.ok(decoded.text.endsWith(`Payload:\n${JSON.stringify(payload, null, 2)}`));
});

test("JWT expiration records the local-time preference without changing NumericDates", () => {
  const payload = { exp: NOW + 600, iat: NOW - 60 };
  const result = check(payload, { useLocalTime: true });
  assert.equal(result.jsonPreview?.value.useLocalTime, true);
  assert.equal(result.jsonPreview?.value.checkedAt, NOW);
  assert.equal(result.jsonPreview?.value.expiresAt, payload.exp);
  assert.ok(result.text.includes(`Expires: ${new Date(payload.exp * 1000).toLocaleString()}`));
});

test("JWT expiration keeps malformed tokens rejected", () => {
  assert.throws(() => run(context("not-a-jwt")), { code: "invalid-jwt" });
});

test("JWT expiration summary reader returns validated timing and optional payload", () => {
  for (const decodePayload of [false, true]) {
    const result = check({ exp: NOW + 600, nbf: NOW - 30, sub: "example" }, { decodePayload });
    assert.deepEqual(getExpirationSummary(result), result.jsonPreview.value);
  }
});

test("JWT expiration summary reader rejects missing or malformed previews", () => {
  const valid = check({ exp: NOW + 600 });
  for (const result of [
    null,
    undefined,
    { render: "text", text: "Status: Active" },
    { ...valid, render: "code" },
    { ...valid, jsonPreview: { ...valid.jsonPreview, render: "table" } },
    ...[null, [], "invalid"].map((value) => ({ ...valid, jsonPreview: { render: "json-tree", value } })),
  ]) {
    assert.equal(getExpirationSummary(result), null);
  }
});

test("JWT expiration summary reader rejects unsafe fields before a renderer formats dates", () => {
  const valid = check({ exp: NOW + 600 });
  for (const replacement of [
    { state: "verified" },
    { checkedAt: null },
    { checkedAt: Infinity },
    { expiresAt: "2100-01-01" },
    { expiresAt: DATE_LIMIT + 1 },
    { issuedAt: -DATE_LIMIT - 1 },
    { notBefore: NaN },
    { notBefore: undefined },
    { useLocalTime: "false" },
    { payload: [] },
    { payload: null },
  ]) {
    assert.equal(
      getExpirationSummary({
        ...valid,
        jsonPreview: { render: "json-tree", value: { ...valid.jsonPreview.value, ...replacement } },
      }),
      null,
    );
  }
});
