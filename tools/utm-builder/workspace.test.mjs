import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { beforeEach, test, vi } from "vitest";
const definition = await toolSpec("utm-builder");
import { run } from "./run.ts";
import Workspace from "./workspace.tsx";
import { setupReactTools, fill, click, button, field, mountTool } from "../../tests/helpers/react-tools.mjs";
import { mountWorkspace, choose, openSettings } from "../../tests/helpers/tool-workspace.mjs";
import { parseSettings } from "../../lib/tool-framework/settings.ts";

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

const execute = () => click(button("Run test operation"));
async function copied() {
  await click(button("Copy all") ?? button("Copied"));
  return writeText.mock.calls.at(-1)[0];
}

test("UTM destination and campaign edits produce the exact copyable URL", async () => {
  await mountWorkspace(definition, run, Workspace);
  await fill(field(/^Destination URL/), "https://example.com/pricing?ref=homepage#plans");
  await fill(field(/^Campaign source/), "Product Newsletter");
  await fill(field(/^Campaign medium/), "Email");
  await fill(field(/^Campaign name/), "Spring Launch");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/pricing?ref=homepage&utm_source=Product+Newsletter&utm_medium=Email&utm_campaign=Spring+Launch#plans",
  );
});

test("UTM optional fields and processing options preserve their existing behavior", async () => {
  await mountWorkspace(definition, run, Workspace, {
    settings: {
      url: "https://example.com/launch?ref=old#offer",
      source: "Newsletter",
      medium: "Social",
      campaign: "Summer Launch",
    },
  });
  await fill(field(/^Campaign term/), "Dev Tools");
  await fill(field(/^Campaign content/), "Hero CTA");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/launch?ref=old&utm_source=Newsletter&utm_medium=Social&utm_campaign=Summer+Launch&utm_term=Dev+Tools&utm_content=Hero+CTA#offer",
  );

  await openSettings();
  await choose("Value normalization", "Lowercase values");
  await choose("Existing query parameters", "Replace existing query");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/launch?utm_source=newsletter&utm_medium=social&utm_campaign=summer+launch&utm_term=dev+tools&utm_content=hero+cta#offer",
  );

  await fill(field(/^Campaign term/), "");
  await fill(field(/^Campaign content/), "");
  await choose("Existing query parameters", "Keep and merge");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/launch?ref=old&utm_source=newsletter&utm_medium=social&utm_campaign=summer+launch#offer",
  );
});

test("UTM saved example settings populate the form without changing the generated URL", async () => {
  await mountWorkspace(definition, run, Workspace, {
    settings: {
      url: "https://acme.example/pricing?ref=homepage",
      source: "linkedin",
      medium: "paid_social",
      campaign: "spring_launch",
      content: "hero_cta",
      normalization: "lowercase",
      existingQuery: "merge",
    },
  });
  assert.equal(field(/^Destination URL/).value, "https://acme.example/pricing?ref=homepage");
  assert.equal(field(/^Campaign source/).value, "linkedin");
  assert.equal(field(/^Campaign medium/).value, "paid_social");
  assert.equal(field(/^Campaign name/).value, "spring_launch");
  assert.equal(field(/^Campaign content/).value, "hero_cta");
  await execute();
  assert.equal(
    await copied(),
    "https://acme.example/pricing?ref=homepage&utm_source=linkedin&utm_medium=paid_social&utm_campaign=spring_launch&utm_content=hero_cta",
  );
});

test("UTM missing campaign input clears stale copy and recovers after correction", async () => {
  const view = await mountWorkspace(definition, run, Workspace);
  await execute();
  await copied();
  await fill(field(/^Campaign source/), "");
  await execute();
  assert.ok(view.container.textContent.includes("utm_source is required."));
  assert.equal(button("Copy all").disabled, true);
  await click(button("Copy all"));
  assert.equal(writeText.mock.calls.length, 1, "Missing required input cannot copy the previous result");

  await fill(field(/^Campaign source/), "partner");
  await execute();
  assert.ok(!view.container.textContent.includes("utm_source is required."));
  assert.equal(await copied(), "https://example.com/?utm_source=partner&utm_medium=email&utm_campaign=launch");
});

const parameterKey = (index) => field(`Parameter key ${index}`);
const parameterValue = (index) => field(`Parameter value ${index}`);

function assertParameterIssue(index) {
  const invalidInputs = [parameterKey(index), parameterValue(index)].filter(
    (input) => input?.getAttribute("aria-invalid") === "true",
  );
  assert.ok(invalidInputs.length > 0, "The invalid row identifies the field that needs correction");
  const descriptions = new Set(
    invalidInputs.flatMap((input) =>
      (input.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((description) => description?.getAttribute("role") === "alert" && description.textContent.trim()),
    ),
  );
  assert.equal(descriptions.size, 1, "One inline explanation is associated with the invalid row");
  assert.equal(button("Run test operation").disabled, true);
}

test("UTM additional parameters add, edit, remove, and preserve the exact copyable URL", async () => {
  await mountWorkspace(definition, run, Workspace, {
    settings: { url: "https://example.com/pricing?ref=homepage#plans" },
  });
  assert.equal(parameterKey(1), undefined, "Extra parameter rows are opt-in");
  await click(button("Add parameter"));
  assert.equal(document.activeElement, parameterKey(1));
  await fill(parameterKey(1), "utm_id");
  await fill(parameterValue(1), "Spring 26");
  await click(button("Add parameter"));
  assert.equal(document.activeElement, parameterKey(2));
  await fill(parameterKey(2), "gclid");
  await fill(parameterValue(2), "AbC+123&xyz");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/pricing?ref=homepage&utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_id=Spring+26&gclid=AbC%2B123%26xyz#plans",
  );

  await fill(parameterValue(1), "Summer 26");
  await click(button("Remove parameter 2"));
  assert.equal(document.activeElement, parameterKey(1));
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/pricing?ref=homepage&utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_id=Summer+26#plans",
  );

  await click(button("Remove parameter 1"));
  assert.equal(parameterKey(1), undefined);
  assert.equal(document.activeElement, button("Add parameter"));
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/pricing?ref=homepage&utm_source=newsletter&utm_medium=email&utm_campaign=launch#plans",
  );
});

test("UTM blank extra rows are ignored and incomplete rows recover through inline feedback", async () => {
  await mountWorkspace(definition, run, Workspace);
  await click(button("Add parameter"));
  assert.equal(button("Run test operation").disabled, false);
  await execute();
  assert.equal(await copied(), "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch");

  await fill(parameterValue(1), "banner");
  assertParameterIssue(1);
  assert.equal(button("Copy all").disabled, true, "Incomplete input cannot copy a stale URL");
  await fill(parameterKey(1), "placement");
  assert.equal(button("Run test operation").disabled, false);

  await fill(parameterValue(1), "");
  assertParameterIssue(1);
  await fill(parameterValue(1), "hero banner");
  assert.notEqual(parameterKey(1).getAttribute("aria-invalid"), "true");
  assert.notEqual(parameterValue(1).getAttribute("aria-invalid"), "true");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&placement=hero+banner",
  );
});

test("UTM duplicate extra keys are blocked until the duplicate is corrected", async () => {
  await mountWorkspace(definition, run, Workspace, {
    settings: { parameters: [{ key: "placement", value: "hero" }] },
  });
  await click(button("Add parameter"));
  await fill(parameterKey(2), "placement");
  await fill(parameterValue(2), "footer");
  assertParameterIssue(2);

  await fill(parameterKey(2), "variant");
  assert.equal(button("Run test operation").disabled, false);
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&placement=hero&variant=footer",
  );
});

test("UTM extra rows cannot override any of the five campaign fields", async () => {
  await mountWorkspace(definition, run, Workspace);
  await click(button("Add parameter"));
  await fill(parameterValue(1), "override");
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    await fill(parameterKey(1), key);
    assertParameterIssue(1);
  }

  await fill(parameterKey(1), "utm_id");
  assert.equal(button("Run test operation").disabled, false);
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_id=override",
  );
});

test("UTM hydrated extra parameters remain editable and retain their values", async () => {
  await mountWorkspace(definition, run, Workspace, {
    settings: {
      url: "https://example.com/offer#details",
      parameters: [
        { key: "utm_id", value: "Campaign 42" },
        { key: "gclid", value: "AbC=123" },
      ],
    },
  });
  assert.equal(parameterKey(1).value, "utm_id");
  assert.equal(parameterValue(1).value, "Campaign 42");
  assert.equal(parameterKey(2).value, "gclid");
  assert.equal(parameterValue(2).value, "AbC=123");
  await fill(parameterValue(1), "Campaign 43");
  await execute();
  assert.equal(
    await copied(),
    "https://example.com/offer?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_id=Campaign+43&gclid=AbC%3D123#details",
  );
});

test("UTM invalid extra rows hide a retained result and disable its copy and download actions", async () => {
  const previous = {
    render: "text",
    text: "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_id=previous",
    downloadName: "campaign-url.txt",
  };
  const props = {
    spec: definition,
    input: { text: "", secondary: "", files: [] },
    settings: parseSettings(definition.settings, { parameters: [{ key: "utm_id", value: "" }] }),
    result: previous,
    lifecycle: "invalid",
    onInputChange: vi.fn(),
    onSettingChange: vi.fn(),
    onValidationChange: vi.fn(),
  };
  const view = await mountTool(createElement(Workspace, props), { spec: definition });
  assert.equal(button("Copy all").disabled, true);
  assert.equal(button(/^Download/).disabled, true);
  assert.ok(!view.container.textContent.includes(previous.text), "A retained URL is not presented as current");
  await click(button("Copy all"));
  await click(button(/^Download/));
  assert.equal(writeText.mock.calls.length, 0);

  const current = { ...previous, text: previous.text.replace("utm_id=previous", "utm_id=corrected") };
  await view.rerender(
    createElement(Workspace, {
      ...props,
      settings: parseSettings(definition.settings, { parameters: [{ key: "utm_id", value: "corrected" }] }),
      result: current,
      lifecycle: "completed",
    }),
  );
  assert.equal(button("Copy all").disabled, false);
  assert.equal(button(/^Download/).disabled, false);
  assert.ok(view.container.textContent.includes(current.text));
  assert.ok(!view.container.textContent.includes(previous.text));
  assert.equal(await copied(), current.text);
});
