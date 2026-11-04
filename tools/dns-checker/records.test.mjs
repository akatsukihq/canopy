import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const definition = await toolSpec("dns-checker");
import { run } from "./run.ts";
import { CSV_PREVIEW_ROWS } from "../../lib/tool-framework/limits.ts";

const defaults = Object.fromEntries(
  Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default]),
);
const answers = {
  A: { Status: 0, Answer: [{ TTL: 300, data: "192.0.2.1" }] },
  MX: { Status: 0, Answer: [{ TTL: 600, data: "10 mail.example.com." }] },
  TXT: { Status: 0, Answer: [{ TTL: 120, data: '"v=spf1 -all"' }] },
};

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async (url) => ({
    ok: true,
    json: async () => answers[new URL(url).searchParams.get("type")] ?? { Status: 0 },
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function lookup(settings = {}, text = "example.com") {
  return run({
    input: { text, files: [] },
    settings: { ...defaults, ...settings },
    signal: new AbortController().signal,
  });
}

function queriedTypes() {
  return fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("type"));
}

test("queries exactly the selected types and ignores a stale legacy filter", async () => {
  const result = await lookup({ types: "A,TXT", recordFilter: "MX" });

  expect(queriedTypes()).toEqual(["A", "TXT"]);
  expect(result).toMatchObject({
    render: "text",
    text: 'A\t300\t192.0.2.1\nTXT\t120\t"v=spf1 -all"',
    downloadName: "dns-records.txt",
  });
});

test("normalizes selected types and queries duplicates only once", async () => {
  await lookup({ types: " mx, A ,MX,a, ,txt," });
  expect(queriedTypes()).toEqual(["MX", "A", "TXT"]);
});

test("defaults to all six supported record types", async () => {
  await lookup();
  expect(queriedTypes()).toEqual(["A", "AAAA", "MX", "TXT", "NS", "CNAME"]);
});

for (const types of ["", " , ", "ANY", "A,ANY", "TXT,SRV"]) {
  test(`rejects invalid selection ${JSON.stringify(types)} before contacting the resolver`, async () => {
    await expect(lookup({ types, recordFilter: "MX" })).rejects.toMatchObject({ code: "record-type-unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
}

for (const domain of ["", "not a domain", "localhost"]) {
  test(`rejects invalid domain ${JSON.stringify(domain)} before contacting the resolver`, async () => {
    await expect(lookup({ types: "A" }, domain)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
}

test("normalizes the domain and preserves resolver options", async () => {
  await lookup({ types: "MX", recursive: false, checkDnssec: true }, " HTTPS://WWW.EXAMPLE.COM/path ");
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://dns.google/resolve?name=example.com&type=MX&rd=0&do=1&cd=0");
  expect(options.headers).toEqual({ accept: "application/dns-json" });
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test("raw output contains only selected resolver responses", async () => {
  const result = await lookup({ types: "TXT,MX", recordView: "raw" });
  expect(result).toMatchObject({
    render: "text",
    text: JSON.stringify({ TXT: answers.TXT, MX: answers.MX }, null, 2),
    downloadName: "dns-records.json",
  });
});

test("structured output can omit TTL", async () => {
  const result = await lookup({ types: "A", includeTtl: false });
  expect(result.text).toBe("A\t—\t192.0.2.1");
});

test("an empty answer retains the existing no-records result", async () => {
  const result = await lookup({ types: "CNAME" });
  expect(result.text).toBe("NO_RECORDS\t—\tNo matching DNS records");
});

function resolverResponses(responses) {
  fetchMock.mockImplementation(async (url) => ({
    ok: true,
    json: async () => responses[new URL(url).searchParams.get("type")],
  }));
}

test("previews named records with labeled TTL seconds and a readable summary", async () => {
  const result = await lookup({ types: "A,TXT" });
  expect(result.tablePreview).toMatchObject({
    columns: ["Type", "Name", "Value", "TTL (seconds)"],
    rows: [
      ["A", "example.com", "192.0.2.1", "300"],
      ["TXT", "example.com", '"v=spf1 -all"', "120"],
    ],
    truncated: false,
  });
  expect(result.verdict).toMatchObject({ level: "ok", label: "2 DNS records found for example.com" });
  expect(result.sections[0]).toMatchObject({
    title: "Lookup status",
    body: { columns: ["Type", "Status", "Details"] },
  });
  expect(result.sections[0].body.rows.map((row) => row.slice(0, 2))).toEqual([
    ["A", "Records returned"],
    ["TXT", "Records returned"],
  ]);
});

test("uses actual returned record types and deduplicates aliases across queries", async () => {
  const alias = { name: "example.com.", type: 5, TTL: 300, data: "target.example.net." };
  resolverResponses({
    A: {
      Status: 0,
      Answer: [alias, { name: "target.example.net.", type: 1, TTL: 0, data: "192.0.2.2" }],
    },
    MX: {
      Status: 0,
      Answer: [
        { ...alias, TTL: 299 },
        { name: "target.example.net.", type: 15, data: "10 mail.example.net." },
      ],
    },
  });
  const result = await lookup({ types: "A,MX" });
  expect(result.tablePreview.rows).toEqual([
    ["CNAME", "example.com.", "target.example.net.", "300"],
    ["A", "target.example.net.", "192.0.2.2", "0"],
    ["MX", "target.example.net.", "10 mail.example.net.", "—"],
  ]);
  expect(result.verdict.label).toBe("3 DNS records found for example.com");
  expect(result.text).toBe(
    "CNAME\t300\ttarget.example.net.\nA\t0\t192.0.2.2\nCNAME\t299\ttarget.example.net.\nMX\t—\t10 mail.example.net.",
  );
});

test("preview without TTL still identifies unknown numeric record types safely", async () => {
  resolverResponses({ TXT: { Answer: [{ type: 65280, data: "<script>literal</script>", TTL: 60 }] } });
  const result = await lookup({ types: "TXT", includeTtl: false });
  expect(result.tablePreview.columns).toEqual(["Type", "Name", "Value"]);
  expect(result.tablePreview.rows).toEqual([["TYPE65280", "example.com", "<script>literal</script>"]]);
  expect(result.text).toBe("TYPE65280\t—\t<script>literal</script>");
});

test("raw exports remain byte-for-byte resolver JSON while retaining a table preview", async () => {
  const result = await lookup({ types: "TXT,MX", recordView: "raw" });
  expect(result.text).toBe(JSON.stringify({ TXT: answers.TXT, MX: answers.MX }, null, 2));
  expect(result.downloadName).toBe("dns-records.json");
  expect(result.tablePreview.rows).toHaveLength(2);
  expect(result.verdict.label).toBe("2 DNS records found for example.com");
});

test("successful empty responses explain that selected types have no answers", async () => {
  const result = await lookup({ types: "CNAME" });
  expect(result.tablePreview.rows).toEqual([]);
  expect(result.verdict).toMatchObject({ level: "ok", label: "No DNS records found for example.com" });
  expect(result.verdict.detail).toContain("CNAME");
  expect(result.sections[0].body.rows[0].slice(0, 2)).toEqual(["CNAME", "No records"]);
});

test("NXDOMAIN reports a domain-not-found result instead of an empty successful lookup", async () => {
  resolverResponses({ A: { Status: 3 }, MX: { Status: 3 } });
  const result = await lookup({ types: "A,MX" });
  expect(result.verdict).toMatchObject({ level: "warn", label: "Domain not found: example.com" });
  expect(result.sections[0].body.rows.map((row) => row[1])).toEqual(["Domain not found", "Domain not found"]);
});

for (const status of [2, 5, 9]) {
  test(`DNS status ${status} reports resolver failure rather than no records`, async () => {
    resolverResponses({ A: { Status: status } });
    const result = await lookup({ types: "A" });
    expect(result.verdict.level).toBe("error");
    expect(result.verdict.label).toBe("DNS lookup failed for example.com");
    expect(result.sections[0].body.rows[0].slice(0, 2)).toEqual(["A", "Resolver failed"]);
    expect(result.sections[0].body.rows[0][2]).toContain(String(status));
  });
}

test("mixed successful and failed queries retain useful records with a warning", async () => {
  resolverResponses({ A: answers.A, MX: { Status: 2 } });
  const result = await lookup({ types: "A,MX" });
  expect(result.tablePreview.rows).toHaveLength(1);
  expect(result.verdict).toMatchObject({ level: "warn", label: "DNS lookup warning for example.com" });
  expect(result.verdict.detail).toContain("1 DNS record");
  expect(result.sections[0].body.rows.map((row) => row[1])).toEqual(["Records returned", "Resolver failed"]);
});

test("malformed answer entries and truncated responses produce partial-result warnings", async () => {
  resolverResponses({ A: { Status: 0, TC: true, Answer: [null, {}, ...answers.A.Answer] } });
  const result = await lookup({ types: "A" });
  expect(result.tablePreview.rows).toEqual([["A", "example.com", "192.0.2.1", "300"]]);
  expect(result.verdict.level).toBe("warn");
  expect(result.sections[0].body.rows[0][1]).toBe("Incomplete response");
  expect(result.sections[0].body.rows[0][2]).toContain("truncated");
});

test("unrecognized response structure is warned about, not reported as no records", async () => {
  resolverResponses({ A: {} });
  const result = await lookup({ types: "A" });
  expect(result.verdict.level).toBe("error");
  expect(result.sections[0].body.rows[0][1]).toBe("Invalid response");
});

test("preview stays bounded while counts and structured exports retain every record", async () => {
  const count = CSV_PREVIEW_ROWS + 1;
  resolverResponses({
    TXT: { Status: 0, Answer: Array.from({ length: count }, (_, i) => ({ type: 16, TTL: 60, data: `value-${i}` })) },
  });
  const result = await lookup({ types: "TXT" });
  expect(result.tablePreview.rows).toHaveLength(CSV_PREVIEW_ROWS);
  expect(result.tablePreview.truncated).toBe(true);
  expect(result.verdict.label).toBe(`${count} DNS records found for example.com`);
  expect(result.text.split("\n")).toHaveLength(count);
  expect(result.text).toContain(`TXT\t60\tvalue-${count - 1}`);
});
