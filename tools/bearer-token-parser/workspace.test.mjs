import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Blob as NodeBlob } from "node:buffer";
import React, { act } from "react";
import { beforeEach, test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("bearer-token-parser");
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
const payload = { sub: "123", profile: { name: "Example", roles: ["reader", "writer"] } };

function jwt(tokenHeader = header, tokenPayload = payload) {
  return [tokenHeader, tokenPayload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .concat("dGVzdC1zaWduYXR1cmU")
    .join(".");
}

async function workspace({ token = jwt(), settings = {}, layout = "stacked" } = {}) {
  const text = `Bearer ${token}`;
  const result = run({ input: { text }, settings });
  const view = await mountTool(
    React.createElement(Workspace, {
      spec: { ...definition, layout },
      input: { text, files: [] },
      settings,
      result,
      lifecycle: "completed",
      onInputChange() {},
      onSettingChange() {},
    }),
    { spec: definition },
  );
  return { ...view, result, token };
}

function section(container, label) {
  const region = container.querySelector(`section[aria-label="${label}"]`);
  assert.ok(region, `Missing ${label} region`);
  return region;
}

function claim(section, key) {
  const row = [...section.querySelectorAll("tbody tr")].find(
    (element) => element.querySelector("th code")?.textContent === key,
  );
  assert.ok(row, `Missing ${key} claim`);
  return row.querySelector("td");
}

async function selectView(container, name) {
  const tabs = container.querySelector('[role="tablist"][aria-label="Result view"]');
  assert.ok(tabs, "Missing result view controls");
  const tab = [...tabs.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name);
  assert.ok(tab, `Missing ${name} view`);
  await act(() => tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  assert.equal(tab.getAttribute("aria-selected"), "true");
}

test("Bearer JWT results start with readable sections and exact independent copies", async () => {
  const { container, token } = await workspace();
  const selected = container.querySelector('[role="tablist"][aria-label="Result view"] [aria-selected="true"]');
  assert.equal(selected?.textContent, "Preview");
  assert.equal(field("Authorization header or raw token", container).value, `Bearer ${token}`);
  const tokenSection = section(container, "Extracted token");
  assert.ok(tokenSection.textContent.includes(token));
  await click(button("Copy token", tokenSection));
  assert.equal(writeText.mock.calls.at(-1)[0], token);
  await click(button("Copy header JSON", section(container, "Decoded header")));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(header, null, 2));
  await click(button("Copy payload JSON", section(container, "Decoded payload")));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(payload, null, 2));
  assert.match(container.textContent, /signature not verified/i);
});

test("claim preview preserves scalar types, nested JSON, and HTML-like custom values safely", async () => {
  const tokenPayload = JSON.parse(
    '{"falseValue":false,"zeroValue":0,"nullValue":null,"emptyValue":"","nestedValue":{"roles":["reader",2,false,null]},"listValue":["one",{"two":2}],"__proto__":{"polluted":"no"},"constructor":"<img src=x onerror=alert(1)>","toString":"<script>alert(1)</script>"}',
  );
  const { container } = await workspace({ token: jwt(header, tokenPayload) });
  const decoded = section(container, "Decoded payload");
  assert.equal(claim(decoded, "falseValue").textContent.trim(), "false");
  assert.equal(claim(decoded, "zeroValue").textContent.trim(), "0");
  assert.equal(claim(decoded, "nullValue").textContent.trim(), "null");
  assert.match(claim(decoded, "emptyValue").textContent.trim(), /^(?:""|empty string)$/i);
  for (const key of ["nestedValue", "listValue", "__proto__"]) {
    assert.deepEqual(JSON.parse(claim(decoded, key).querySelector("code").textContent), tokenPayload[key]);
  }
  assert.ok(claim(decoded, "constructor").textContent.includes(tokenPayload.constructor));
  assert.ok(claim(decoded, "toString").textContent.includes(tokenPayload.toString));
  assert.equal(decoded.querySelector("img, script"), null);
  assert.equal({}.polluted, undefined);
  await click(button("Copy payload JSON", decoded));
  assert.equal(writeText.mock.calls.at(-1)[0], JSON.stringify(tokenPayload, null, 2));
});

for (const layout of ["stacked", "side-by-side"]) {
  test(`shared copying retains the original JWT result in both ${layout} views`, async () => {
    const { container, result } = await workspace({ layout });
    const copy = button("Copy all", container);
    for (const view of ["Preview", "Raw", "Preview"]) {
      await selectView(container, view);
      assert.ok(container.contains(copy), "The shared copy action remains available");
      await click(copy);
      assert.equal(writeText.mock.calls.at(-1)[0], result.text);
    }
  });

  test(`shared copying retains the original token and length in both ${layout} views`, async () => {
    const token = "s3cr3t_access_12345";
    const { container } = await workspace({ token, layout });
    const copy = button("Copy all", container);
    for (const view of ["Preview", "Raw", "Preview"]) {
      await selectView(container, view);
      assert.ok(container.contains(copy), "The shared copy action remains available");
      await click(copy);
      assert.equal(writeText.mock.calls.at(-1)[0], `Token: ${token}\nLength: ${token.length}`);
    }
  });
}

test("the shared JWT download preserves the original JSON in side-by-side Preview and Raw views", async () => {
  const downloads = [];
  const blobs = [];
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return `blob:bearer-test-${blobs.length}`;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push({ name: this.download, href: this.href });
  });
  const { container, result } = await workspace({ layout: "side-by-side" });
  for (const view of ["Preview", "Raw"]) {
    await selectView(container, view);
    await click(button("Download .json", container));
  }
  assert.deepEqual(downloads, [
    { name: "result.json", href: "blob:bearer-test-1" },
    { name: "result.json", href: "blob:bearer-test-2" },
  ]);
  for (const blob of blobs) {
    assert.equal(blob.type, "application/json;charset=utf-8");
    assert.equal(await blob.text(), result.text);
  }
});

for (const token of [jwt(), "s3cr3t_access_12345"]) {
  test(`masked ${token.includes(".") ? "JWT" : "opaque token"} output never exposes or copies the raw credential`, async () => {
    const { container } = await workspace({ token, settings: { maskRawToken: true } });
    const extracted = section(container, "Extracted token");
    assert.ok(extracted.textContent.includes("••••••••"));
    assert.equal(extracted.textContent.includes(token), false);
    await click(button("Copy token", extracted));
    assert.equal(writeText.mock.calls.at(-1)[0], "••••••••");
    const copy = button("Copy all", container);
    await click(copy);
    await selectView(container, "Raw");
    await click(copy);
    for (const [copied] of writeText.mock.calls) assert.equal(copied.includes(token), false);
  });
}

test("opaque token preview explains the undecoded result and its length", async () => {
  const token = "s3cr3t_access_12345";
  const { container } = await workspace({ token });
  const extracted = section(container, "Extracted token");
  assert.ok(extracted.textContent.includes(token));
  assert.match(container.textContent, /Token content has not been decoded\./);
  assert.ok(extracted.textContent.includes(`${token.length} characters`));
  await click(button("Copy length", extracted));
  assert.equal(writeText.mock.calls.at(-1)[0], String(token.length));
  assert.equal(container.querySelector('section[aria-label="Decoded payload"]'), null);
});

test("disabling JWT decoding does not misclassify a JWT as opaque", async () => {
  const token = jwt();
  const { container } = await workspace({ token, settings: { decodeJwtParts: false } });
  assert.ok(section(container, "Extracted token").textContent.includes(token));
  assert.match(container.textContent, /Token content has not been decoded\./);
  assert.doesNotMatch(container.textContent, /opaque/i);
  assert.equal(container.querySelector('section[aria-label="Decoded header"]'), null);
  assert.equal(container.querySelector('section[aria-label="Decoded payload"]'), null);
});

test("empty JWT sections explain that no claims are present and copy exact empty JSON", async () => {
  const { container } = await workspace({ token: jwt({}, {}) });
  for (const name of ["header", "payload"]) {
    const decoded = section(container, `Decoded ${name}`);
    assert.match(decoded.textContent, /No claims\./);
    await click(button(`Copy ${name} JSON`, decoded));
    assert.equal(writeText.mock.calls.at(-1)[0], "{}");
  }
});
