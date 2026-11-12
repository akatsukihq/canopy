import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { run } from "./run.server.ts";
import { readDomainRating } from "./result.ts";

vi.mock("@/lib/config/integrations.ts", () => ({ ahrefsApiKey: async () => "" }));

const LICENSE = "http://ahrefs.com/legal/domain-rating-license";

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function lookup(domainRating) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => ({ domain_rating: domainRating }),
  }));
  return run({
    input: { text: "example.com" },
    settings: {},
    signal: new AbortController().signal,
  });
}

test("a zero Domain Rating with an omitted warning produces the attributed result", async () => {
  const result = await lookup({ domain_rating: 0, license: LICENSE });

  expect(result).toEqual({
    render: "text",
    text: `Target: example.com\nDomain Rating: 0\nDomain Rating by Ahrefs\nLicense: ${LICENSE}\nWarning: None`,
    downloadName: "example.com-domain-rating.txt",
    domainRating: { target: "example.com", score: 0, license: LICENSE, warning: null },
  });
  expect(readDomainRating(result)).toEqual(result.domainRating);
});

test("null and blank warnings remain absent in the readable result", async () => {
  for (const warning of [null, "", "   "]) {
    const result = await lookup({ domain_rating: 0, license: LICENSE, warning });
    expect(result.text).toContain("Domain Rating: 0\n");
    expect(result.text).toContain(`License: ${LICENSE}\nWarning: None`);
    expect(result.domainRating.warning).toBeNull();
  }
});

test("nonempty warnings and licence attribution remain visible with surrounding whitespace removed", async () => {
  const result = await lookup({ domain_rating: 100, license: ` ${LICENSE} `, warning: " Data may be delayed. " });

  expect(result.text).toContain("Domain Rating: 100\nDomain Rating by Ahrefs\n");
  expect(result.text).toContain(`License: ${LICENSE}\nWarning: Data may be delayed.`);
  expect(readDomainRating(result)).toEqual({
    target: "example.com",
    score: 100,
    license: LICENSE,
    warning: "Data may be delayed.",
  });
});

test("fractional ratings and multiline warnings retain their exact values without parsing output lines", async () => {
  const warning = "Data may be delayed.\nDomain Rating: 99\nRetry later.";
  const result = await lookup({ domain_rating: 42.75, license: LICENSE, warning: ` \n${warning}\n ` });

  expect(result.text).toBe(
    `Target: example.com\nDomain Rating: 42.75\nDomain Rating by Ahrefs\nLicense: ${LICENSE}\nWarning: ${warning}`,
  );
  expect(readDomainRating(result)).toEqual({ target: "example.com", score: 42.75, license: LICENSE, warning });
  expect(result.downloadName).toBe("example.com-domain-rating.txt");
});

test("malformed and oversized warnings remain invalid", async () => {
  for (const warning of [false, 7, {}, [], "x".repeat(2_001)]) {
    await expect(lookup({ domain_rating: 0, license: LICENSE, warning })).rejects.toMatchObject({
      code: "upstream-invalid",
      message: "Ahrefs returned an invalid response.",
    });
  }
});

test("ratings outside the numeric zero-to-one-hundred range remain invalid", async () => {
  for (const domain_rating of [-1, 101, "0", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(lookup({ domain_rating, license: LICENSE, warning: null })).rejects.toMatchObject({
      code: "upstream-invalid",
    });
  }
});

test("missing, blank, non-string and oversized licences remain invalid", async () => {
  for (const license of [undefined, null, "", "   ", false, 7, "x".repeat(1_001)]) {
    await expect(lookup({ domain_rating: 0, license, warning: null })).rejects.toMatchObject({
      code: "upstream-invalid",
    });
  }
});

test("the preview reader rejects absent and malformed rating metadata instead of inventing a score", () => {
  const domainRating = { target: "example.com", score: 0, license: LICENSE, warning: null };
  const result = { render: "text", text: "Domain Rating: 99", domainRating };

  for (const invalid of [
    { render: "text", text: result.text },
    { ...result, render: "code" },
    { ...result, domainRating: null },
    { ...result, domainRating: [] },
    ...[
      { target: undefined },
      { target: "   " },
      { target: 7 },
      { score: undefined },
      { score: "0" },
      { score: -1 },
      { score: 101 },
      { score: Number.NaN },
      { score: Number.POSITIVE_INFINITY },
      { license: undefined },
      { license: "   " },
      { license: false },
      { warning: undefined },
      { warning: false },
      { warning: 0 },
      { warning: {} },
    ].map((patch) => ({ ...result, domainRating: { ...domainRating, ...patch } })),
  ]) {
    expect(readDomainRating(invalid)).toBeNull();
  }

  expect(readDomainRating(result)).toEqual(domainRating);
});
