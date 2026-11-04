import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("open-graph-preview");
import { parseMetadata } from "./metadata.ts";
import { setupReactTools, mountTool, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

async function selectTab(name) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name);
  assert.ok(tab);
  await act(() => tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

const parsed = parseMetadata(
  '<title>Fallback title</title><meta property="og:title" content="Shared page"><meta property="og:description" content="Useful description"><meta name="twitter:title" content="X-specific title">',
  "https://example.com/page",
);
const result = {
  render: "link-preview",
  requestedUrl: "https://example.com/old",
  resolvedUrl: "https://example.com/page",
  ...parsed,
  downloadName: "open-graph-tags.html",
};

function Fixture({
  initial = "",
  result = null,
  error,
  initiallyRunning = false,
  onRun = () => {},
  onCancel = () => {},
  actionDisabled = false,
}) {
  const [input, setInput] = useState({ text: initial, files: [] });
  const [running, setRunning] = useState(initiallyRunning);
  return React.createElement(Workspace, {
    spec: definition,
    settings: {},
    input,
    result,
    error,
    running,
    lifecycle: running ? "running" : error ? "failed" : result ? "completed" : "ready",
    onInputChange: setInput,
    onSettingChange() {},
    primaryAction: {
      label: "Scan URL",
      disabled: actionDisabled,
      running,
      onRun,
      onCancel() {
        setRunning(false);
        onCancel();
      },
    },
  });
}

test("Open Graph workspace blocks invalid URLs, links the error to its field, and submits a corrected domain", async () => {
  const onRun = vi.fn();
  await mountTool(React.createElement(Fixture, { onRun }), { spec: definition });
  assert.equal(button("Scan URL").disabled, true);
  await fill(field(/^Website URL/), "javascript:alert(1)");
  const input = field(/^Website URL/);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.ok(document.getElementById(input.getAttribute("aria-describedby"))?.textContent);
  assert.equal(button("Scan URL").disabled, true);
  await fill(input, "example.com");
  assert.equal(input.getAttribute("aria-invalid"), "false");
  assert.equal(button("Scan URL").disabled, false);
  await click(button("Scan URL"));
  assert.equal(onRun.mock.calls.length, 1);
});

test("Open Graph cancellation returns to Scan without accidentally submitting again", async () => {
  const onRun = vi.fn();
  const onCancel = vi.fn();
  await mountTool(React.createElement(Fixture, { initial: "example.com", initiallyRunning: true, onRun, onCancel }), {
    spec: definition,
  });
  assert.equal(field(/^Website URL/).disabled, true);
  await click(button("Cancel"));
  assert.equal(onCancel.mock.calls.length, 1);
  assert.equal(onRun.mock.calls.length, 0);
  assert.equal(field(/^Website URL/).disabled, false);
  assert.equal(button("Scan URL").disabled, false);
});

test("Open Graph failed scans offer Edit URL and honor an externally disabled action", async () => {
  const onRun = vi.fn();
  await mountTool(
    React.createElement(Fixture, {
      initial: "example.com",
      error: "Website could not be reached.",
      actionDisabled: true,
      onRun,
    }),
    { spec: definition },
  );
  await click(button("Edit URL"));
  assert.equal(document.activeElement, field(/^Website URL/));
  await click(button("Scan URL"));
  assert.equal(onRun.mock.calls.length, 0);
});

test("Open Graph previews switch platforms and expose exact fetched tags for copying", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { container } = await mountTool(React.createElement(Fixture, { initial: "example.com", result }), {
    spec: definition,
  });
  assert.ok(button("Rescan"));
  for (const platform of ["Facebook", "X", "LinkedIn", "WhatsApp", "Discord"]) {
    await selectTab(platform);
    const preview = container.querySelector(`[aria-label="${platform} link preview"]`);
    assert.ok(preview, `${platform} preview is available after selecting its tab`);
    assert.ok(preview.textContent.includes(platform === "X" ? "X-specific title" : "Shared page"));
  }
  await selectTab("HTML tags");
  assert.equal(field("Fetched HTML tags").readOnly, true);
  assert.equal(field("Fetched HTML tags").value, result.tags);
  await click(button(/^Copy/));
  assert.deepEqual(writeText.mock.calls, [[result.tags]]);
  assert.ok(container.textContent.includes("https://example.com/old"));
  assert.ok(container.textContent.includes("https://example.com/page"));
});

test("Open Graph localizes check instructions and ICU counts while copying exact fetched tags", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const parsed = parseMetadata(
    '<meta property="og:title" content="Titre 日本"><meta property="og:title" content="Second">',
    "https://example.com",
  );
  const result = {
    render: "link-preview",
    requestedUrl: "https://example.com",
    resolvedUrl: "https://example.com",
    ...parsed,
  };
  const { container } = await mountTool(React.createElement(Fixture, { initial: "example.com", result }), {
    spec: definition,
    locale: "fr",
    messages: {
      "runtime.checks.titleFound": "Titre Open Graph trouvé",
      "runtime.checks.descriptionMissing": "Description Open Graph manquante",
      "runtime.checks.addDescription": "Ajoutez og:description pour décrire la page.",
      "runtime.checks.duplicateTags": "Balises {property} en double",
      "runtime.checks.duplicateValues": "{count, number} valeurs trouvées.",
    },
  });
  assert.ok(container.textContent.includes("Titre Open Graph trouvé"));
  assert.ok(container.textContent.includes("Description Open Graph manquante"));
  assert.ok(container.textContent.includes("Ajoutez og:description pour décrire la page."));
  assert.ok(container.textContent.includes("Balises og:title en double"));
  assert.ok(container.textContent.includes("2 valeurs trouvées."));
  assert.ok(container.textContent.includes("Titre 日本"));
  await selectTab("HTML tags");
  assert.equal(field("Fetched HTML tags").value, result.tags);
  await click(button("Tout copier"));
  assert.deepEqual(writeText.mock.calls, [[result.tags]]);
});
