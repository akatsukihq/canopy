import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import DnsCheckerWorkspace from "./workspace.tsx";
import { withToolIntl } from "../../tests/helpers/react-tools.mjs";
const definition = await toolSpec("dns-checker");

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", () => ({
  CodeEditor: ({ value, "aria-label": label }) =>
    React.createElement("textarea", { "aria-label": label, value, readOnly: true }),
}));

let container;
let root;
let writeText;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function resultFixture(overrides = {}) {
  const result = {
    render: "text",
    text: "A\t300\t192.0.2.1\nMX\t0\t10 mail.example.com.",
    downloadName: "dns-records.txt",
    verdict: {
      level: "ok",
      label: "2 DNS records found for example.com",
      detail: "Both requested record types returned answers.",
    },
    tablePreview: {
      render: "table",
      columns: ["Type", "Name", "Value", "TTL (seconds)"],
      rows: [
        ["A", "example.com.", "192.0.2.1", "300"],
        ["MX", "example.com.", "10 mail.example.com.", "0"],
      ],
    },
    sections: [
      {
        title: "Lookup status",
        body: {
          render: "table",
          columns: ["Type", "Status", "Details"],
          rows: [
            ["A", "Records returned", "1 record returned."],
            ["MX", "Records returned", "1 record returned."],
          ],
        },
      },
    ],
    ...overrides,
  };
  if (overrides.tablePreview && !overrides.sections) {
    result.sections[0].body.rows = [...new Set(overrides.tablePreview.rows.map(([type]) => type))].map((type) => [
      type,
      "Records returned",
      "Records returned for this query.",
    ]);
  }
  return result;
}

async function mount(result, { error, domain = "example.com" } = {}) {
  await act(() =>
    root.render(
      withToolIntl(
        React.createElement(DnsCheckerWorkspace, {
          spec: definition,
          settings: Object.fromEntries(
            Object.entries(definition.settings.fields).map(([key, field]) => [key, field.default]),
          ),
          input: { text: domain, files: [] },
          lifecycle: error ? "failed" : "completed",
          result,
          error,
          onInputChange: () => {},
          onSettingChange: () => {},
        }),
        definition,
      ),
    ),
  );
}

const resultTabs = () => [
  ...container.querySelector('[role="tablist"][aria-label="Result view"]').querySelectorAll('[role="tab"]'),
];
const activePanel = () =>
  [...container.querySelectorAll('[role="tabpanel"]')].find((panel) => panel.getAttribute("data-state") === "active");
const recordTable = () => activePanel().querySelector('table[aria-label="DNS records"]');

async function chooseView(label) {
  const tab = resultTabs().find((item) => item.textContent === label);
  expect(tab).toBeTruthy();
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: false })));
}

async function copy(button) {
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

test("Preview is the first selected view and explains records and remaining cache time", async () => {
  const result = resultFixture();
  await mount(result);
  expect(resultTabs().map((tab) => tab.textContent)).toEqual(["Preview", "Raw"]);
  expect(resultTabs()[0].getAttribute("aria-selected")).toBe("true");
  expect(activePanel().textContent).toContain(result.verdict.label);
  expect(activePanel().textContent).toContain(result.verdict.detail);
  expect(recordTable().textContent).toMatch(/IPv4 address/);
  expect(recordTable().textContent).toMatch(/Mail server/);
  expect(recordTable().textContent).toContain("example.com.");
  expect(recordTable().textContent).toContain("300 s");
  expect(recordTable().textContent).toContain("0 s");
  expect(recordTable().querySelectorAll("tbody tr")).toHaveLength(2);
  expect(activePanel().textContent).toMatch(/resolver.*remaining cache|remaining.*cache.*resolver/i);
});

test("successful records and missing query outcomes appear in the same table", async () => {
  const result = resultFixture();
  result.sections[0].body.rows.push(["TXT", "No records", "The resolver returned no TXT answers."]);
  await mount(result);

  expect(activePanel().querySelectorAll("table")).toHaveLength(1);
  const rows = [...recordTable().querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.cells[0].textContent)).toEqual(["A", "MX", "TXT"]);
  const missing = rows.find((row) => row.cells[0].textContent === "TXT");
  expect(missing.textContent).toContain("No TXT records found");
  expect(missing.querySelector('button[aria-label^="Copy"]')).toBeNull();
  await copy(rows[0].querySelector('button[aria-label="Copy A record value"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("192.0.2.1");
});

test("failed and incomplete queries stay visible beside CNAME answers from other record types", async () => {
  await mount(
    resultFixture({
      text: "CNAME\t300\ttarget.example.net.\nAAAA\t60\t2001:db8::1",
      verdict: { level: "warn", label: "Some lookups were incomplete", detail: "Review the query outcomes." },
      tablePreview: {
        render: "table",
        columns: ["Type", "Name", "Value", "TTL (seconds)"],
        rows: [
          ["CNAME", "example.com.", "target.example.net.", "300"],
          ["AAAA", "target.example.net.", "2001:db8::1", "60"],
        ],
      },
      sections: [
        {
          title: "Lookup status",
          body: {
            render: "table",
            columns: ["Type", "Status", "Details"],
            rows: [
              ["A", "Resolver failed", "The A lookup failed after returning an alias. Try again."],
              ["CNAME", "Records returned", "1 answer returned."],
              ["AAAA", "Incomplete response", "The resolver returned only part of the AAAA response."],
            ],
          },
        },
      ],
    }),
  );

  expect(activePanel().querySelectorAll("table")).toHaveLength(1);
  const rows = [...recordTable().querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(4);
  expect(rows.find((row) => row.cells[0].textContent === "A").textContent).toContain("Resolver failed");
  expect(recordTable().textContent).toContain("The A lookup failed after returning an alias. Try again.");
  expect(recordTable().textContent).toContain("The resolver returned only part of the AAAA response.");
  expect(recordTable().textContent).toContain("2001:db8::1");
  await copy(recordTable().querySelector('button[aria-label="Copy CNAME record value"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("target.example.net.");
});

test("an alias-only answer is distinguished from a query that returned no records", async () => {
  await mount(
    resultFixture({
      text: "CNAME\t300\ttarget.example.net.",
      tablePreview: {
        render: "table",
        columns: ["Type", "Name", "Value", "TTL (seconds)"],
        rows: [["CNAME", "example.com.", "target.example.net.", "300"]],
      },
      sections: [
        {
          title: "Lookup status",
          body: {
            render: "table",
            columns: ["Type", "Status", "Details"],
            rows: [["A", "Records returned", "1 answer returned. Aliases may appear under their actual record type."]],
          },
        },
      ],
    }),
  );

  const rows = [...recordTable().querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(2);
  const query = rows.find((row) => row.cells[0].textContent === "A");
  expect(query.textContent).toContain("Other record type returned");
  expect(recordTable().textContent).not.toContain("No A records found");
  expect(recordTable().textContent).toContain("target.example.net.");
});

test("record owners are shown only when different from the normalized queried domain", async () => {
  await mount(
    resultFixture({
      tablePreview: {
        render: "table",
        columns: ["Type", "Name", "Value", "TTL (seconds)"],
        rows: [
          ["A", "EXAMPLE.COM.", "192.0.2.1", "300"],
          ["A", "alias.example.net.", "192.0.2.2", "60"],
        ],
      },
    }),
    { domain: "HTTPS://WWW.EXAMPLE.COM/path" },
  );

  const rows = [...recordTable().querySelectorAll("tbody tr")];
  expect(rows[0].textContent.toLowerCase()).not.toContain("example.com");
  expect(rows[1].textContent).toContain("alias.example.net.");
  await copy(rows[1].querySelector('button[aria-label="Copy A record value"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("192.0.2.2");
});

test("Raw view and the export copy retain the exact underlying text after toggling views", async () => {
  const result = resultFixture();
  await mount(result);
  await chooseView("Raw");
  expect(resultTabs()[1].getAttribute("aria-selected")).toBe("true");
  const raw = activePanel().querySelector("textarea, pre");
  expect(raw?.value ?? raw?.textContent).toBe(result.text);
  expect(activePanel().textContent).not.toContain(result.verdict.label);
  expect(activePanel().textContent).not.toContain(result.verdict.detail);
  expect(activePanel().querySelector('table[aria-label="Lookup status"]')).toBeNull();
  expect(activePanel().textContent).not.toContain("Lookup status");
  expect(activePanel().textContent).not.toContain("1 record returned.");
  await copy(container.querySelector('button[aria-label="Copy all"]'));
  expect(writeText).toHaveBeenLastCalledWith(result.text);
  await chooseView("Preview");
  expect(resultTabs()[0].getAttribute("aria-selected")).toBe("true");
  expect(recordTable().textContent).toContain("192.0.2.1");
});

test("long TXT and markup values remain literal text and copy exactly", async () => {
  const value = '"v=spf1 <img src=x onerror=alert(1)> include:example.com ' + "x".repeat(800) + ' -all"';
  await mount(
    resultFixture({
      text: `TXT\t300\t${value}`,
      tablePreview: {
        render: "table",
        columns: ["Type", "Name", "Value", "TTL (seconds)"],
        rows: [["TXT", "example.com.", value, "300"]],
      },
    }),
  );
  const row = [...recordTable().querySelectorAll("tbody tr")][0];
  expect(row.textContent).toContain(value);
  expect(row.querySelector("img, script")).toBeNull();
  await copy(row.querySelector('button[aria-label^="Copy"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
});

for (const value of ["", '""']) {
  test(`empty TXT value ${JSON.stringify(value)} is explained while copying its exact representation`, async () => {
    await mount(
      resultFixture({
        text: `TXT\t300\t${value}`,
        tablePreview: {
          render: "table",
          columns: ["Type", "Name", "Value", "TTL (seconds)"],
          rows: [["TXT", "example.com.", value, "300"]],
        },
      }),
    );
    const row = recordTable().querySelector("tbody tr");
    expect(row.textContent).toContain("Empty value");
    await copy(row.querySelector('button[aria-label="Copy TXT record value"]'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
  });
}

test("MX records explain preference while copying the original priority and mail server", async () => {
  await mount(resultFixture());
  const copyButton = recordTable().querySelector('button[aria-label="Copy MX record value"]');
  const row = copyButton.closest("tr");
  expect(row.textContent).toContain("10 mail.example.com.");
  expect(row.textContent).toMatch(/first number is priority.*lower numbers are preferred/i);
  expect(row.textContent).not.toMatch(/does not accept email/i);
  await copy(copyButton);
  expect(writeText).toHaveBeenCalledExactlyOnceWith("10 mail.example.com.");
});

test("null MX explains that the domain accepts no email and copies the exact null record", async () => {
  await mount(
    resultFixture({
      text: "MX\t300\t0 .",
      tablePreview: {
        render: "table",
        columns: ["Type", "Name", "Value", "TTL (seconds)"],
        rows: [["MX", "example.com.", "0 .", "300"]],
      },
    }),
  );
  const row = recordTable().querySelector("tbody tr");
  expect(row.textContent).toMatch(/domain declares that it does not accept email/i);
  expect(row.textContent).not.toMatch(/lower numbers are preferred/i);
  await copy(row.querySelector('button[aria-label="Copy MX record value"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("0 .");
});

test("disabled TTL output omits cache-time cells without losing copyable records", async () => {
  await mount(
    resultFixture({
      tablePreview: { render: "table", columns: ["Type", "Name", "Value"], rows: [["A", "example.com.", "192.0.2.1"]] },
    }),
  );
  expect([...recordTable().querySelectorAll("th")].map((cell) => cell.textContent).join(" ")).not.toMatch(
    /TTL|Cache time/i,
  );
  expect(recordTable().textContent).toContain("192.0.2.1");
  await copy(recordTable().querySelector('tbody button[aria-label^="Copy"]'));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("192.0.2.1");
});

test("empty answers show the outcome and explain each unsuccessful lookup", async () => {
  const result = resultFixture({
    text: "NO_RECORDS\t—\tNo matching DNS records",
    verdict: {
      level: "warn",
      label: "No DNS records found for example.com",
      detail: "No answers were returned for the selected record types.",
    },
    tablePreview: { render: "table", columns: ["Type", "Name", "Value", "TTL (seconds)"], rows: [] },
    sections: [
      {
        title: "Lookup status",
        body: {
          render: "table",
          columns: ["Type", "Status", "Details"],
          rows: [
            ["MX", "No records", "The domain exists, but no MX answers were returned."],
            ["TXT", "Domain not found", "Check the domain spelling and try again."],
          ],
        },
      },
    ],
  });
  await mount(result);
  expect(activePanel().textContent).toContain(result.verdict.label);
  expect(activePanel().textContent).toContain(result.verdict.detail);
  expect(activePanel().textContent).toContain("No MX records found");
  expect(activePanel().textContent).toContain("Check the domain spelling and try again.");
  expect(activePanel().textContent).not.toContain("NO_RECORDS");
  expect(activePanel().querySelectorAll("table")).toHaveLength(1);
  expect(recordTable().querySelectorAll("tbody tr")).toHaveLength(2);
});

test("failed lookups explain the problem and next action in Preview", async () => {
  await mount(
    resultFixture({
      verdict: {
        level: "error",
        label: "DNS lookup failed for example.com",
        detail: "The resolver could not answer the requested lookup. Try again in a moment.",
      },
      tablePreview: { render: "table", columns: ["Type", "Name", "Value", "TTL (seconds)"], rows: [] },
      sections: [
        {
          title: "Lookup status",
          body: {
            render: "table",
            columns: ["Type", "Status", "Details"],
            rows: [["A", "Server failure", "The resolver could not complete this query."]],
          },
        },
      ],
    }),
  );
  expect(activePanel().textContent).toContain("DNS lookup failed for example.com");
  expect(activePanel().textContent).toContain("Try again in a moment.");
  expect(activePanel().textContent).toContain("Server failure");
  expect(recordTable().querySelectorAll("tbody tr")).toHaveLength(1);
});
