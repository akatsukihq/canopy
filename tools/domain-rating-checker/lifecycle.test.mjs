import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import ToolPage from "../../components/ToolPage.tsx";
const spec = await toolSpec("domain-rating-checker");
import { setupReactTools, mountTool, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/devtools/domain-rating-checker",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

setupReactTools();
let apiRequests;
let workerRequests;
let workerFailure;
let writeText;

beforeEach(() => {
  apiRequests = [];
  workerRequests = [];
  workerFailure = { code: "unknown-tool", message: "This tool is not available." };
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  // jsdom has no Worker transport. The real useToolRun hook consumes the same
  // failure message that a missing run.worker entry produces in the browser.
  vi.stubGlobal(
    "Worker",
    class {
      terminate() {
        this.terminated = true;
      }
      postMessage(message) {
        if (message.type !== "run") return;
        workerRequests.push(message);
        queueMicrotask(() => {
          if (!this.terminated) this.onmessage?.({ data: { type: "failure", jobId: message.jobId, ...workerFailure } });
        });
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) => {
      if (String(url) === "/api/tools/ecosystem") return Promise.resolve(Response.json({ groups: [] }));
      if (String(url) !== "/api/tools/domain-rating-checker") throw new Error(`Unexpected request ${url}`);
      return new Promise((resolve) => apiRequests.push({ url: String(url), options, resolve }));
    }),
  );
});

async function mountPage() {
  const view = await mountTool(
    React.createElement(ToolPage, {
      account: { returnTo: "/devtools/domain-rating-checker", user: null },
      category: "SEO & Domain Tools",
      definitionKey: "domain-rating-checker",
      description: spec.description,
      icon: { kind: "generated" },
      relatedTools: [],
      spec,
      title: spec.name,
    }),
  );
  await waitFor(() => expect(field(/Public domain/, view.container)).toBeTruthy());
  return view;
}

function ratingResult(target, score) {
  const license = "https://ahrefs.com/legal/domain-rating-license";
  return {
    render: "text",
    text: `Target: ${target}\nDomain Rating: ${score}\nDomain Rating by Ahrefs\nLicense: ${license}\nWarning: None`,
    downloadName: `${target}-domain-rating.txt`,
    domainRating: { target, score, license, warning: null },
  };
}

async function respond(request, response) {
  await act(async () => {
    request.resolve(response);
  });
}

test("server-only execution falls through the missing worker, sends the exact request, and displays/copies the result", async () => {
  const view = await mountPage();
  await fill(field(/Public domain/), "example.com");
  await click(button("Check domain rating"));
  await waitFor(() => expect(apiRequests).toHaveLength(1));
  expect(workerRequests).toHaveLength(1);
  expect(workerRequests[0]).toMatchObject({
    type: "run",
    key: "domain-rating-checker",
    text: "example.com",
    settings: {},
    files: [],
  });
  expect(apiRequests[0].options).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
  expect(JSON.parse(apiRequests[0].options.body)).toEqual({ text: "example.com", settings: {} });
  expect(apiRequests[0].options.signal.aborted).toBe(false);
  expect(field(/Public domain/).disabled).toBe(true);
  expect(button("Cancel")).toBeTruthy();
  expect(view.container.querySelector('[data-testid="tool-workspace"]').getAttribute("aria-busy")).toBe("true");
  const result = ratingResult("example.com", 0);
  await respond(apiRequests[0], Response.json({ result }));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain rating summary"]')?.textContent).toContain("0out of 100"),
  );
  expect(field(/Public domain/).disabled).toBe(false);
  await click(button("Copy all"));
  expect(writeText).toHaveBeenLastCalledWith(result.text);
  await click(button("Reset"));
  await waitFor(() => expect(field(/Public domain/).value).toBe(""));
  expect(view.container.querySelector('[aria-label="Domain rating summary"]')).toBeNull();
});

test.each([
  [
    "provider rejection",
    () =>
      Response.json(
        { error: { code: "upstream-rate-limited", message: "The provider is busy. Try again shortly." } },
        { status: 429 },
      ),
    "The provider is busy. Try again shortly.",
  ],
  [
    "malformed API response",
    () => new Response("<html>Proxy failure</html>", { status: 502 }),
    "This tool returned an invalid response.",
  ],
])("%s surfaces the actual runtime error and recovers after edited input", async (_name, response, message) => {
  const view = await mountPage();
  await fill(field(/Public domain/), "example.com");
  await click(button("Check domain rating"));
  await waitFor(() => expect(apiRequests).toHaveLength(1));
  await respond(apiRequests[0], response());
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid="tool-status-line"]')?.textContent).toContain(message),
  );
  expect(button("Check domain rating").disabled).toBe(false);
  expect(view.container.querySelector('[aria-label="Domain rating summary"]')).toBeNull();
  await fill(field(/Public domain/), "retry.example");
  await click(button("Check domain rating"));
  await waitFor(() => expect(apiRequests).toHaveLength(2));
  expect(JSON.parse(apiRequests[1].options.body).text).toBe("retry.example");
  await respond(apiRequests[1], Response.json({ result: ratingResult("retry.example", 52.5) }));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain rating summary"]')?.textContent).toContain(
      "52.5out of 100",
    ),
  );
  expect(view.container.querySelector('[data-testid="tool-status-line"]').textContent).not.toContain(message);
});

test("a genuine worker processing failure is shown without accidentally calling the server", async () => {
  workerFailure = { code: "processing-failed", message: "Worker could not finish. Retry the operation." };
  const view = await mountPage();
  await fill(field(/Public domain/), "example.com");
  await click(button("Check domain rating"));
  await waitFor(() =>
    expect(view.container.querySelector('[data-testid="tool-status-line"]')?.textContent).toContain(
      workerFailure.message,
    ),
  );
  expect(workerRequests).toHaveLength(1);
  expect(apiRequests).toHaveLength(0);
});

test("canceling the server request aborts its signal and late data cannot replace a newer result", async () => {
  const view = await mountPage();
  await fill(field(/Public domain/), "first.example");
  await click(button("Check domain rating"));
  await waitFor(() => expect(apiRequests).toHaveLength(1));
  await click(button("Cancel"));
  expect(apiRequests[0].options.signal.aborted).toBe(true);
  await fill(field(/Public domain/), "second.example");
  await click(button("Check domain rating"));
  await waitFor(() => expect(apiRequests).toHaveLength(2));
  await respond(apiRequests[1], Response.json({ result: ratingResult("second.example", 22) }));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain rating summary"]')?.textContent).toContain(
      "second.example",
    ),
  );
  // Deliberately deliver an aborted response anyway to exercise runtime stale-result protection.
  await respond(apiRequests[0], Response.json({ result: ratingResult("first.example", 99) }));
  await waitFor(() =>
    expect(view.container.querySelector('[aria-label="Domain rating summary"]')?.textContent).toContain("22out of 100"),
  );
  expect(view.container.querySelector('[aria-label="Domain rating summary"]').textContent).not.toContain(
    "first.example",
  );
});
