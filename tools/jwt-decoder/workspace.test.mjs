import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import React, { act } from "react";
import { beforeEach, test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("jwt-decoder");
import { run } from "./run.ts";
import { setupReactTools, mountTool, click, button, field } from "../../tests/helpers/react-tools.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

let writeText;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});

const header = { alg: "HS256", typ: "JWT", kid: "test-key" };
const payload = {
  sub: "123",
  exp: 4102444800,
  profile: { name: "Example", roles: ["reader", "writer"], active: true },
};
const signature = "dGVzdC1zaWduYXR1cmU";

async function workspace({ tokenHeader = header, tokenPayload = payload, tokenSignature = signature } = {}) {
  const token = [tokenHeader, tokenPayload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .concat(tokenSignature)
    .join(".");
  const result = run({ input: { text: token }, settings: {} });
  const view = await mountTool(
    React.createElement(Workspace, {
      spec: definition,
      input: { text: token, files: [] },
      settings: {},
      result,
      lifecycle: "completed",
      onInputChange() {},
      onSettingChange() {},
    }),
    { spec: definition },
  );
  return { ...view, result };
}

function section(container, label) {
  const region = container.querySelector(`section[aria-label="${label}"]`);
  assert.ok(region, `Missing ${label} region`);
  return region;
}

async function selectTab(scope, name) {
  const tab = [...scope.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name);
  assert.ok(tab, `Missing ${name} tab`);
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  assert.equal(tab.getAttribute("aria-selected"), "true");
}

test("JWT preview exposes separate exact header, payload, and signature copies", async () => {
  const { container } = await workspace();
  const headerSection = section(container, "Decoded header");
  const payloadSection = section(container, "Decoded payload");
  assert.deepEqual(JSON.parse(headerSection.querySelector("code").textContent), header);
  assert.deepEqual(JSON.parse(payloadSection.querySelector("code").textContent), payload);

  await click(button("Copy header JSON", headerSection));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(header, null, 2));
  await click(button("Copy payload JSON", payloadSection));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(payload, null, 2));
  await click(button("Copy signature", section(container, "Signature")));
  assert.equal(writeText.mock.calls.at(-1)[0], signature);
});

test("header and payload can independently switch between JSON and claims without losing nested values", async () => {
  const { container } = await workspace();
  const headerSection = section(container, "Decoded header");
  const payloadSection = section(container, "Decoded payload");
  await selectTab(payloadSection, "Claims");
  assert.ok(payloadSection.textContent.includes("2100-01-01T00:00:00.000Z (UTC)"));
  assert.ok(payloadSection.textContent.includes(JSON.stringify(payload.profile, null, 2)));
  assert.deepEqual(JSON.parse(headerSection.querySelector("code").textContent), header);

  await selectTab(headerSection, "Claims");
  assert.ok(headerSection.textContent.includes("Signing algorithm"));
  assert.equal(payloadSection.querySelector('[role="tab"][aria-selected="true"]').textContent, "Claims");
  await selectTab(payloadSection, "JSON");
  assert.deepEqual(JSON.parse(payloadSection.querySelector("code").textContent), payload);
  assert.equal(headerSection.querySelector('[role="tab"][aria-selected="true"]').textContent, "Claims");
});

test("raw view and the shared result copy retain the full original decoded output", async () => {
  const { container, result } = await workspace();
  const copy = button("Copy all", container);
  await click(copy);
  assert.equal(writeText.mock.calls.at(-1)[0], result.text);
  await selectTab(container.querySelector('[role="tablist"][aria-label="Result view"]'), "Raw");
  assert.equal(field("Result code", container).value, result.text);
  assert.equal(field("Result code", container).readOnly, true);
  await click(copy);
  assert.equal(writeText.mock.calls.at(-1)[0], result.text);
  await selectTab(container.querySelector('[role="tablist"][aria-label="Result view"]'), "Preview");
  await click(copy);
  assert.equal(writeText.mock.calls.at(-1)[0], result.text);
});

test("an unsigned token exposes its empty signature without offering an empty copy", async () => {
  const { container, result } = await workspace({ tokenHeader: { alg: "none" }, tokenSignature: "" });
  const signatureSection = section(container, "Signature");
  assert.ok(signatureSection.textContent.includes("Unsigned token"));
  assert.equal(button("Copy signature", signatureSection), undefined);
  assert.equal(JSON.parse(result.text).signature, "");
  assert.ok(container.textContent.includes("Signature not verified"));
});

test("HTML-like values and prototype-like claim names remain safely rendered custom data", async () => {
  const tokenPayload = JSON.parse(
    '{"__proto__":{"polluted":"no"},"constructor":"<img src=x onerror=alert(1)>","toString":"<script>alert(1)</script>"}',
  );
  const { container } = await workspace({ tokenPayload });
  const payloadSection = section(container, "Decoded payload");
  assert.deepEqual(JSON.parse(payloadSection.querySelector("code").textContent), tokenPayload);
  await selectTab(payloadSection, "Claims");
  assert.equal(payloadSection.querySelectorAll("dt").length, 3);
  for (const term of payloadSection.querySelectorAll("dt")) assert.ok(term.textContent.includes("Custom claim"));
  assert.ok(payloadSection.textContent.includes(tokenPayload.constructor));
  assert.ok(payloadSection.textContent.includes(tokenPayload.toString));
  assert.equal(payloadSection.querySelector("img, script"), null);
  assert.equal({}.polluted, undefined);
  await click(button("Copy payload JSON", payloadSection));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(tokenPayload, null, 2));
});
