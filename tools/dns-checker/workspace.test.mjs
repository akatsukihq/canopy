import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, expect, test, vi } from "vitest";
import {
  setupReactTools,
  mountTool,
  fill,
  click,
  button,
  field,
  waitFor,
  TextEditorBoundary,
} from "../../tests/helpers/react-tools.mjs";
import ToolPage from "../../components/ToolPage.tsx";
const spec = await toolSpec("dns-checker");
import { choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", () => ({
  CodeEditor: (props) => React.createElement(TextEditorBoundary, props),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  usePathname: () => "/devtools/dns-checker",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

setupReactTools();
let requests;
let writeText, blobs, downloads;
beforeEach(() => {
  requests = [];
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  blobs = [];
  downloads = [];
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:dns-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push(this.download);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      if (String(url) === "/api/tools/ecosystem?locale=en")
        return Promise.resolve(new Response(JSON.stringify({ groups: [] })));
      if (!String(url).startsWith("https://dns.google/resolve?")) throw new Error(`Unexpected request ${url}`);
      return new Promise((resolve, reject) => requests.push({ url: new URL(url), options, resolve, reject }));
    }),
  );
});

async function mountPage() {
  const view = await mountTool(
    React.createElement(ToolPage, {
      account: { returnTo: "/devtools/dns-checker", user: null },
      category: "SEO & Domain Tools",
      definitionKey: "dns-checker",
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

async function finishRequests(domain, address) {
  const matching = requests.filter(({ url }) => url.searchParams.get("name") === domain);
  expect(matching.length).toBe(6);
  for (const request of matching)
    request.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, TTL: 60, data: address }] })));
}

test("DNS page runs its real adapter and runtime, then resets source and result", async () => {
  const view = await mountPage();
  await fill(field(/Domain name/), "example.com");
  await click(button("Check DNS"));
  await waitFor(() => expect(requests.length).toBe(6));
  await finishRequests("example.com", "192.0.2.7");
  await waitFor(() => expect(view.container.textContent).toContain("192.0.2.7"));
  await click(button("Reset"));
  await waitFor(() => expect(field(/Domain name/).value).toBe(""));
  expect(view.container.textContent).not.toContain("192.0.2.7");
});

test("DNS settings reach the resolver and raw JSON copy/download preserve every response", async () => {
  const view = await mountPage();
  await fill(field(/Domain name/), "example.com");
  await openSettings(view.container);
  await choose("Raw output format", "Resolver response (JSON)");
  await click(field("Use recursive lookup"));
  await click(field("Check DNSSEC"));
  await click(button("Check DNS"));
  await waitFor(() => expect(requests).toHaveLength(6));
  expect(requests.map(({ url }) => url.searchParams.get("type"))).toEqual(["A", "AAAA", "MX", "TXT", "NS", "CNAME"]);
  for (const { url } of requests) {
    expect(url.searchParams.get("rd")).toBe("0");
    expect(url.searchParams.get("do")).toBe("1");
    expect(url.searchParams.get("cd")).toBe("0");
  }
  const responses = {
    A: { Status: 0, Answer: [{ type: 1, TTL: 60, data: "192.0.2.7" }] },
    AAAA: { Status: 0 },
    MX: { Status: 0 },
    TXT: { Status: 0 },
    NS: { Status: 0 },
    CNAME: { Status: 0 },
  };
  await act(async () => {
    for (const request of requests) request.resolve(Response.json(responses[request.url.searchParams.get("type")]));
  });
  await waitFor(() => expect(view.container.textContent).toContain("192.0.2.7"));
  await click(button("Copy all"));
  expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(responses, null, 2));
  await click(button("Download .json"));
  expect(downloads).toEqual(["dns-records.json"]);
  expect(await blobs[0].text()).toBe(JSON.stringify(responses, null, 2));
});

test("DNS page prevents a canceled response from restoring stale results", async () => {
  const view = await mountPage();
  await fill(field(/Domain name/), "first.example");
  await click(button("Check DNS"));
  await waitFor(() => expect(requests.length).toBe(6));
  await click(button("Cancel"));
  await fill(field(/Domain name/), "second.example");
  await click(button("Check DNS"));
  await waitFor(() => expect(requests.length).toBe(12));
  await finishRequests("second.example", "192.0.2.22");
  await waitFor(() => expect(view.container.textContent).toContain("192.0.2.22"));
  await finishRequests("first.example", "192.0.2.11");
  await waitFor(() => expect(view.container.textContent).not.toContain("192.0.2.11"));
  expect(view.container.textContent).toContain("192.0.2.22");
});

test("DNS page recovers from an upstream failure by rerunning edited input", async () => {
  const view = await mountPage();
  await fill(field(/Domain name/), "example.com");
  await click(button("Check DNS"));
  await waitFor(() => expect(requests.length).toBe(6));
  for (const request of requests) request.reject(new TypeError("Offline"));
  await waitFor(() =>
    expect(view.container.textContent).toContain("DNS Checker could not reach the public DNS service."),
  );
  await waitFor(() => expect(button("Check DNS").disabled).toBe(false));
  await fill(field(/Domain name/), "retry.example");
  await click(button("Check DNS"));
  await waitFor(() => expect(requests.length).toBe(12));
  await finishRequests("retry.example", "192.0.2.33");
  await waitFor(() => expect(view.container.textContent).toContain("192.0.2.33"));
});
