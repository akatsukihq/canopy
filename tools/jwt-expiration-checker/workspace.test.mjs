import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("jwt-expiration-checker");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, openSettings } from "../../tests/helpers/tool-workspace.mjs";

vi.mock("@/components/FileProcessorWorkspace", () => ({ FileProcessorWorkspace: () => null }));
vi.mock("@/app/media/components/ImageConversionWorkspace", () => ({ ImageConversionWorkspace: () => null }));
vi.mock("@/components/content/CodeEditor", async () => ({
  CodeEditor: (await import("../../tests/helpers/react-tools.mjs")).TextEditorBoundary,
}));
setupReactTools();

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const NOW_SECONDS = NOW / 1000;
const jwt = (payload) =>
  `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;
const execute = () => click(button("Run test operation"));
let writeText;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "clipboard", { value: { writeText } }));
});

async function copied(label = "Copy all") {
  await click(button(label) ?? (label === "Copy all" ? button("Copied") : undefined));
  return writeText.mock.calls.at(-1)[0];
}

test("JWT summary explains a missing expiration and preserves the exact raw report", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: jwt({ sub: "sample", iat: 1516239022 }) });
  await execute();
  assert.equal(button("Summary").getAttribute("aria-selected"), "true");
  assert.ok(view.container.textContent.includes("No expiration specified"));
  assert.ok(view.container.textContent.includes("expiration cannot be determined"));
  assert.ok(view.container.textContent.includes("does not mean the token will remain accepted indefinitely"));
  assert.ok(view.container.textContent.includes("Expires at"));
  assert.ok(view.container.textContent.includes("Not valid before"));
  assert.ok(view.container.textContent.includes("Issued at"));
  assert.ok(view.container.textContent.includes("2018"));
  assert.ok(view.container.textContent.includes("UTC"));
  assert.ok(view.container.textContent.includes("Signature not verified"));
  assert.equal(
    view.container.querySelector('time[datetime="2018-01-18T01:30:22.000Z"]')?.textContent.includes("2018"),
    true,
  );
  assert.equal(button("Copy payload JSON"), undefined, "Payload is not exposed by default");
  const report = "Status: No expiration claim\nExpires: not specified\nIssued: 2018-01-18T01:30:22.000Z";
  assert.equal(await copied(), report);

  await act(() => button("Raw").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  assert.equal(button("Raw").getAttribute("aria-selected"), "true");
  assert.equal(await copied(), report);
});

test("JWT summary distinguishes expired, future, active, and nearly expired windows", async () => {
  const view = await mountWorkspace(definition, run, Workspace, {
    text: jwt({ exp: NOW_SECONDS - 60 }),
    settings: { warnBeforeExpiry: true },
  });
  const states = [
    [{ exp: NOW_SECONDS - 60 }, "Token has expired"],
    [{ exp: NOW_SECONDS + 3600, nbf: NOW_SECONDS + 60 }, "Not active yet"],
    [{ exp: NOW_SECONDS + 3600, nbf: NOW_SECONDS - 60 }, "Within its time window"],
    [{ exp: NOW_SECONDS + 120 }, "Expiration is near"],
  ];
  for (const [payload, heading] of states) {
    await fill(field(/^JWT token/), jwt(payload));
    await execute();
    assert.ok(view.container.textContent.includes(heading), `The summary reports ${heading}`);
    for (const [, other] of states) {
      if (other !== heading) assert.ok(!view.container.textContent.includes(other), `${other} is not stale`);
    }
  }
});

test("JWT payload is opt-in, copies exact JSON, and can be hidden again", async () => {
  const payload = { sub: "synthetic-example", exp: NOW_SECONDS + 3600, role: "reader" };
  const view = await mountWorkspace(definition, run, Workspace, { text: jwt(payload) });
  await execute();
  assert.equal(button("Copy payload JSON"), undefined);
  assert.ok(!view.container.textContent.includes("synthetic-example"));

  await openSettings();
  const toggle = () => field("Decode payload");
  await click(toggle());
  await execute();
  assert.ok(view.container.textContent.includes("synthetic-example"));
  assert.equal(await copied("Copy payload JSON"), JSON.stringify(payload, null, 2));
  assert.ok((await copied()).endsWith(`Payload:\n${JSON.stringify(payload, null, 2)}`));

  await click(toggle());
  await execute();
  assert.equal(button("Copy payload JSON"), undefined);
  assert.ok(!view.container.textContent.includes("synthetic-example"));
  assert.ok(!(await copied()).includes("Payload:"));
});

test("JWT invalid-input recovery clears the previous result and copy action", async () => {
  const view = await mountWorkspace(definition, run, Workspace, { text: jwt({ exp: NOW_SECONDS - 60 }) });
  await execute();
  await copied();
  await fill(field(/^JWT token/), "invalid-token");
  await execute();
  assert.ok(view.container.textContent.includes("JWT must contain three dot-separated parts."));
  assert.ok(!view.container.textContent.includes("Token has expired"));
  assert.equal(button("Copy all").disabled, true);
  await click(button("Copy all"));
  assert.equal(writeText.mock.calls.length, 1, "Invalid input cannot copy the earlier result");

  await fill(field(/^JWT token/), jwt({ exp: NOW_SECONDS + 3600 }));
  await execute();
  assert.ok(view.container.textContent.includes("Within its time window"));
  assert.ok(!view.container.textContent.includes("JWT must contain three dot-separated parts."));
  assert.equal(await copied(), "Status: Active\nExpires: 2026-09-26T13:00:00.000Z\nIssued: not specified");
});
