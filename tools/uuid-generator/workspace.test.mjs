import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { beforeEach, test, vi } from "vitest";
import Workspace from "./workspace.tsx";
const definition = await toolSpec("uuid-generator");
import { run } from "./run.ts";
import { setupReactTools, fill, click, button, field, waitFor } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

let writeText;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const DNS_EXAMPLE = {
  v3: "9073926b-929f-31c2-abc9-fad77ae3e8eb",
  v5: "cfbff0d1-9375-5685-968c-48ce8b15ae17",
};
const control = (key) => field(definition.settings.fields[key].label);
const execute = () => click(button("Run test operation"));

async function chooseSetting(key, value) {
  const setting = definition.settings.fields[key];
  const choice = setting.choices.find((entry) => entry.value === value);
  assert.ok(choice, `Missing ${value} option`);
  await choose(setting.label, choice.label);
}

async function copied() {
  await waitFor(() => assert.ok(button(/^(Copy all|Copied)$/)));
  await click(button(/^(Copy all|Copied)$/));
  return writeText.mock.calls.at(-1)[0];
}

test("random and time-based UUID versions retain the requested count and copy complete generated values", async () => {
  await mountWorkspace(definition, run, Workspace);
  await fill(control("count"), "2");
  for (const version of ["v1", "v4", "v6", "v7"]) {
    await chooseSetting("version", version);
    assert.equal(control("count").value, "2");
    assert.equal(control("name"), undefined);
    assert.equal(control("namespace"), undefined);
    assert.equal(control("customNamespace"), undefined);
    await execute();
    const values = (await copied()).split("\n");
    assert.equal(values.length, 2);
    const uuid = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version.slice(1)}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`);
    for (const value of values) assert.match(value, uuid);
    assert.notEqual(values[0], values[1]);
  }
});

test("v3 and v5 expose name settings, generate one deterministic UUID, and restore count on switching back", async () => {
  await mountWorkspace(definition, run, Workspace);
  await fill(control("count"), "7");
  for (const version of ["v3", "v5"]) {
    await chooseSetting("version", version);
    assert.equal(control("count"), undefined);
    assert.ok(control("namespace"));
    assert.equal(control("name").value, "example.com");
    assert.equal(control("customNamespace"), undefined);
    await execute();
    assert.equal(await copied(), DNS_EXAMPLE[version]);
    await execute();
    assert.equal(await copied(), DNS_EXAMPLE[version]);
  }
  await chooseSetting("version", "v4");
  assert.equal(control("count").value, "7");
  assert.equal(control("namespace"), undefined);
  assert.equal(control("name"), undefined);
});

test("custom namespace errors recover after entering a valid UUID and its value persists across namespace changes", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { settings: { version: "v5" } });
  await chooseSetting("namespace", "custom");
  assert.ok(control("customNamespace"));
  await fill(control("customNamespace"), "not-a-uuid");
  await execute();
  await waitFor(() => assert.ok(view.container.textContent.includes("Enter a valid namespace UUID.")));
  assert.equal(button("Copy all")?.disabled, true);
  await fill(control("customNamespace"), DNS);
  await execute();
  assert.equal(await copied(), DNS_EXAMPLE.v5);
  await chooseSetting("namespace", DNS);
  assert.equal(control("customNamespace"), undefined);
  await chooseSetting("namespace", "custom");
  assert.equal(control("customNamespace").value, DNS);
});

test("name-based UUIDs honor name edits and shared uppercase and hyphen formatting", async () => {
  await mountWorkspace(definition, run, Workspace, { settings: { version: "v5" } });
  await fill(control("name"), "www.example.com");
  await click(control("hyphens"));
  await click(control("upper"));
  await execute();
  assert.equal(await copied(), "2ED6657DE927568B95E12665A8AEA6A2");
  await chooseSetting("version", "v3");
  await fill(control("name"), "example.com");
  await execute();
  assert.equal(await copied(), DNS_EXAMPLE.v3.replaceAll("-", "").toUpperCase());
  await chooseSetting("version", "v7");
  await fill(control("count"), "1");
  await execute();
  assert.match(await copied(), /^[0-9A-F]{12}7[0-9A-F]{3}[89AB][0-9A-F]{15}$/);
});
