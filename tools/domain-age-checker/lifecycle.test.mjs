import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import ToolPage from "../../components/ToolPage.tsx";
const spec = await toolSpec("domain-age-checker");
import { setupReactTools, mountTool, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/devtools/domain-age-checker",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  redirect() {},
  permanentRedirect() {},
}));

setupReactTools();
let requests, writeText;
beforeEach(() => {
  requests = [];
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      if (String(url) === "/api/tools/ecosystem") return Promise.resolve(Response.json({ groups: [] }));
      if (!String(url).startsWith("https://rdap.org/domain/")) throw new Error(`Unexpected request ${url}`);
      return new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject }));
    }),
  );
});

async function mountPage() {
  const view = await mountTool(
    React.createElement(ToolPage, {
      account: { returnTo: "/devtools/domain-age-checker", user: null },
      category: "SEO & Domain Tools",
      definitionKey: "domain-age-checker",
      description: spec.description,
      icon: { kind: "generated" },
      relatedTools: [],
      spec,
      title: spec.name,
    }),
    { spec, appProviders: true },
  );
  await waitFor(() => expect(field(/Domain name/, view.container)).toBeTruthy());
  return view;
}

const registration = {
  ldhName: "example.com",
  events: [
    { eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" },
  ],
  status: ["clientTransferProhibited"],
  nameservers: [{ ldhName: "ns1.example.com" }],
};

test("actual page applies both date settings to executed output, copies it, and resets", async () => {
  const view = await mountPage();
  await fill(field(/Domain name/), "https://www.example.com/path");
  await openSettings(view.container);
  await click(field("Show registration date"));
  await click(field("Show expiry date"));
  await click(button("Check domain age"));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].url).toBe("https://rdap.org/domain/example.com");
  expect(field(/Domain name/).disabled).toBe(true);
  await act(async () => requests[0].resolve(Response.json(registration)));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain registration summary"]')?.textContent).toContain(
      "Age unavailable",
    ),
  );
  const summary = view.container.querySelector('[aria-label="Domain registration summary"]').textContent;
  expect(summary).toContain("hidden");
  expect(summary).not.toContain("2000");
  expect(summary).not.toContain("2030");
  await click(button("Copy all"));
  expect(writeText).toHaveBeenLastCalledWith(
    JSON.stringify(
      {
        domain: "example.com",
        updated: null,
        status: ["clientTransferProhibited"],
        nameservers: ["ns1.example.com"],
      },
      null,
      2,
    ),
  );
  await click(button("Reset"));
  await waitFor(() => expect(field(/Domain name/).value).toBe(""));
  expect(view.container.querySelector('[aria-label="Domain registration summary"]')).toBeNull();
});

test.each([
  ["HTTP rejection", (request) => request.resolve(Response.json({}, { status: 404 })), "RDAP lookup failed (404)."],
  [
    "network disconnection",
    (request) => request.reject(new TypeError("private transport details")),
    "Domain Age Checker could not reach the public RDAP service.",
  ],
])("actual page exposes %s and recovers with a fresh lookup", async (_label, fail, message) => {
  const view = await mountPage();
  await fill(field(/Domain name/), "failed.example");
  await click(button("Check domain age"));
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => fail(requests[0]));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid="tool-status-line"]')?.textContent).toContain(message),
  );
  expect(view.container.textContent).not.toContain("private transport details");
  expect(button("Check domain age").disabled).toBe(false);
  await fill(field(/Domain name/), "retry.example");
  await click(button("Check domain age"));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].url).toBe("https://rdap.org/domain/retry.example");
  await act(async () => requests[1].resolve(Response.json({ ...registration, ldhName: "retry.example" })));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain registration summary"]')?.textContent).toContain(
      "retry.example",
    ),
  );
  expect(view.container.querySelector('[data-testid="tool-status-line"]').textContent).not.toContain(message);
});
