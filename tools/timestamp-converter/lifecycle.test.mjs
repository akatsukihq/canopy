import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
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
import { choose } from "../../tests/helpers/tool-workspace.mjs";
import ToolPage from "../../components/ToolPage.tsx";
const spec = await toolSpec("timestamp-converter");

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", () => ({
  CodeEditor: (props) => React.createElement(TextEditorBoundary, props),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/devtools/timestamp-converter",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

setupReactTools();
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url) === "/api/tools/ecosystem") return new Response(JSON.stringify({ groups: [] }));
      throw new Error(`Unexpected request ${url}`);
    }),
  );
});

async function mountPage() {
  const view = await mountTool(
    React.createElement(ToolPage, {
      account: { returnTo: "/devtools/timestamp-converter", user: null },
      category: "Date & Time Tools",
      definitionKey: "timestamp-converter",
      description: spec.description,
      icon: { kind: "generated" },
      relatedTools: [],
      spec,
      title: spec.name,
    }),
  );
  await waitFor(() => expect(field(/^Timestamp or date/)).toBeTruthy());
  return view;
}

test("live conversion executes through ToolPage without a synthetic run button and refreshes after settings changes", async () => {
  const view = await mountPage();
  await fill(field(/^Timestamp or date/), "1000");
  await waitFor(() => expect(view.container.textContent).toContain("ISO: 1970-01-01T00:16:40.000Z"));
  await choose("Input unit", "Milliseconds");
  await waitFor(() => expect(view.container.textContent).toContain("ISO: 1970-01-01T00:00:01.000Z"));
  expect(view.container.textContent).not.toContain("ISO: 1970-01-01T00:16:40.000Z");
  await fill(field(/^Timestamp or date/), "2000");
  await waitFor(() => expect(view.container.textContent).toContain("ISO: 1970-01-01T00:00:02.000Z"));
  await click(button("Reset"));
  await waitFor(() => expect(field(/^Timestamp or date/).value).toBe(""));
  expect(view.container.textContent).not.toContain("ISO: 1970-01-01T00:00:02.000Z");
});

test("live conversion recovers from invalid input and reset cancels the pending debounce", async () => {
  const view = await mountPage();
  await fill(field(/^Timestamp or date/), "invalid-date");
  const invalidFeedback = "Timestamp or date is not a valid date or timestamp.";
  await waitFor(() => expect(view.container.textContent).toContain(invalidFeedback));
  expect(view.container.textContent).not.toContain("ISO:");
  expect(button("Copy all")?.disabled ?? true).toBe(true);
  await fill(field(/^Timestamp or date/), "1704067200");
  await waitFor(() => expect(view.container.textContent).toContain("ISO: 2024-01-01T00:00:00.000Z"));
  expect(view.container.textContent).not.toContain(invalidFeedback);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await fill(field(/^Timestamp or date/), "1900000000");
    await click(button("Reset"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(field(/^Timestamp or date/).value).toBe("");
    expect(view.container.textContent).not.toContain("ISO:");
  } finally {
    try {
      await view.unmount();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }
});
