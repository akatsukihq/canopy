import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { button, click, field, fill, mountTool, setupReactTools } from "./helpers/react-tools.mjs";
import ToolPage from "../components/ToolPage.tsx";
const slugSpec = await toolSpec("slug-generator");
const contrastSpec = await toolSpec("contrast-checker");
import { run as runSlug } from "../tools/slug-generator/run.ts";
import { run as runContrast } from "../tools/contrast-checker/run.ts";
import { decodeToolShare, encodeToolShare } from "../lib/tool-framework/toolShare.ts";

const observed = vi.hoisted(() => ({ slugRun: vi.fn(), contrastRun: vi.fn() }));

vi.mock("../tools/slug-generator/run", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: (request) => {
      const pending = observed.slugRun(request);
      if (pending) return pending.then(() => actual.run(request));
      return actual.run(request);
    },
  };
});
vi.mock("../tools/contrast-checker/run", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: (request) => {
      observed.contrastRun(request);
      return actual.run(request);
    },
  };
});

vi.mock("@/components/UniversalWorkbench", async () => {
  const { ToolRuntimeProvider } = await import("../lib/tool-runtime/useToolRuntime.tsx");
  return {
    UniversalWorkbench: ({ runtimeSpec, Toolbar, Workspace }) =>
      React.createElement(
        ToolRuntimeProvider,
        { spec: runtimeSpec },
        React.createElement(Toolbar),
        React.createElement(Workspace),
      ),
  };
});

vi.mock("@/components/ToolWorkspace", () => ({
  ToolWorkspace: ({ input, onInputChange, settings, onSettingChange, lifecycle, result, error }) =>
    React.createElement(
      "section",
      null,
      React.createElement("textarea", {
        "aria-label": "Source",
        value: input.text,
        onChange: (event) => onInputChange({ ...input, text: event.target.value }),
      }),
      ...Object.entries(settings).map(([key, value]) =>
        React.createElement("textarea", {
          key,
          "aria-label": key,
          value: String(value),
          onChange: (event) => onSettingChange(key, event.target.value),
        }),
      ),
      React.createElement("output", { "aria-label": "Lifecycle" }, lifecycle),
      React.createElement("output", { "aria-label": "Result" }, result ? JSON.stringify(result) : ""),
      React.createElement("output", { "aria-label": "Error" }, error),
    ),
}));
vi.mock("../tools/contrast-checker/workspace", async () => {
  const { ToolWorkspace } = await import("@/components/ToolWorkspace");
  return { default: ToolWorkspace };
});

vi.mock("@/components/ui/index.tsx", () => ({
  Button: ({ children, variant, size, tooltip, ...props }) => React.createElement("button", props, children),
  Select: ({ children, size, ...props }) => React.createElement("select", props, children),
  Toaster: () => null,
  TooltipProvider: ({ children }) => children,
  Tooltip: ({ children }) => children,
  TooltipTrigger: ({ children }) => children,
  TooltipContent: () => null,
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/ToolIcon", () => ({ ToolIcon: () => null }));
vi.mock("@/components/FileInput", () => ({ workspaceFileId: () => "test-file" }));
vi.mock("@/app/media/lib/imageConversion", () => ({
  resolveImageConversion: (spec, settings) => ({ choices: [], spec, settings }),
}));
vi.mock("@/lib/analytics/ga4", () => ({ trackToolEvent: vi.fn() }));
vi.mock("@/lib/tool-framework/artifacts", () => ({
  cleanupArtifactJobWithRetry: vi.fn(async () => {}),
  sweepStaleArtifactJobsOnce: vi.fn(async () => {}),
  createArtifactWriter: () => ({ write: vi.fn() }),
}));
vi.mock("@/lib/tool-framework/useToolRun", () => {
  const worker = {
    state: { status: "idle", jobId: null },
    cancel: vi.fn(),
    cleanupArtifacts: vi.fn(),
    reset: vi.fn(),
    start: vi.fn(),
  };
  return { useToolRun: () => worker };
});

setupReactTools();

beforeEach(() => {
  window.history.replaceState({ router: "retained" }, "", "/devtools/tool");
  observed.slugRun.mockReset();
  observed.contrastRun.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function share(spec, state) {
  const encoded = encodeToolShare(spec, state);
  expect(encoded).toHaveProperty("hash");
  window.history.replaceState(window.history.state, "", encoded.hash);
}

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

async function tick(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function mount(spec, definitionKey, { strict = false } = {}) {
  const page = React.createElement(ToolPage, {
    account: { returnTo: "/", user: null },
    category: spec.category,
    definitionKey,
    description: spec.description,
    icon: { kind: "mark", text: "T" },
    relatedTools: [],
    spec,
    title: spec.name,
  });
  const view = await mountTool(strict ? React.createElement(React.StrictMode, null, page) : page);
  await settle();
  return view;
}

const result = () => document.querySelector('output[aria-label="Result"]').textContent;

test("a shared manual tool restores its source and runs exactly once without clicking Run", async () => {
  share(slugSpec, { input: { text: "Café Menu\nAnother Title" }, settings: {} });
  await mount(slugSpec, "slug-generator");
  await tick(1000);
  expect(field("Source").value).toBe("Café Menu\nAnother Title");
  expect(observed.slugRun).toHaveBeenCalledTimes(1);
  expect(observed.slugRun.mock.calls[0][0].input.text).toBe("Café Menu\nAnother Title");
  expect(result()).toContain("cafe-menu");
  expect(result()).toContain("another-title");
  expect(JSON.parse(result())).toEqual(runSlug({ input: { text: "Café Menu\nAnother Title" } }));
  expect(window.history.state).toEqual({ router: "retained" });
});

test("StrictMode restores a manual share and executes it once across its repeated effect setup", async () => {
  share(slugSpec, { input: { text: "Strict Mode Title" }, settings: {} });
  await mount(slugSpec, "slug-generator", { strict: true });
  await tick(1000);
  expect(field("Source").value).toBe("Strict Mode Title");
  expect(observed.slugRun).toHaveBeenCalledTimes(1);
  expect(result()).toContain("strict-mode-title");
  expect(decodeToolShare(slugSpec, window.location.hash).state.input.text).toBe("Strict Mode Title");
});

test("editing before a restored manual run starts recovers sharing for the new input", async () => {
  share(slugSpec, { input: { text: "Shared Before Edit" }, settings: {} });
  await mount(slugSpec, "slug-generator");
  expect(field("Source").value).toBe("Shared Before Edit");
  expect(observed.slugRun).not.toHaveBeenCalled();
  await fill(field("Source"), "Edited Before Restore Ran");
  await click(button("Generate slugs"));
  await settle();
  await tick(300);
  expect(observed.slugRun).toHaveBeenCalledTimes(1);
  expect(observed.slugRun.mock.calls[0][0].input.text).toBe("Edited Before Restore Ran");
  expect(result()).toContain("edited-before-restore-ran");
  expect(decodeToolShare(slugSpec, window.location.hash).state.input.text).toBe("Edited Before Restore Ran");
});

test.each(["pending", "completed", "ready"])(
  "hash navigation replaces a %s manual run once and clearing the hash restores defaults",
  async (previousState) => {
    let finishPrevious;
    if (previousState === "pending") {
      observed.slugRun.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPrevious = resolve;
          }),
      );
    }
    share(slugSpec, { input: { text: "Previous Title" }, settings: {} });
    await mount(slugSpec, "slug-generator");
    await tick(1000);
    expect(observed.slugRun).toHaveBeenCalledTimes(1);
    if (previousState === "pending") {
      expect(document.querySelector('output[aria-label="Lifecycle"]').textContent).toBe("running");
    } else {
      expect(result()).toContain("previous-title");
    }
    if (previousState === "ready") {
      await fill(field("Source"), "An unrun edit");
      await tick(500);
      expect(document.querySelector('output[aria-label="Lifecycle"]').textContent).toBe("ready");
    }

    await act(async () => {
      share(slugSpec, { input: { text: "Navigated Title" }, settings: {} });
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    await tick(1000);
    expect(field("Source").value).toBe("Navigated Title");
    expect(observed.slugRun).toHaveBeenCalledTimes(2);
    expect(result()).toContain("navigated-title");
    expect(decodeToolShare(slugSpec, window.location.hash).state.input.text).toBe("Navigated Title");

    if (finishPrevious) {
      await act(async () => finishPrevious());
      await settle();
      await tick(1000);
      expect(result()).toContain("navigated-title");
      expect(observed.slugRun).toHaveBeenCalledTimes(2);
    }

    await act(async () => {
      window.history.replaceState(window.history.state, "", "/devtools/tool");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await tick(1000);
    expect(field("Source").value).toBe("");
    expect(result()).toBe("");
    expect(document.querySelector('output[aria-label="Lifecycle"]').textContent).toBe("empty");
    expect(window.location.hash).toBe("");
    expect(observed.slugRun).toHaveBeenCalledTimes(2);
  },
);

test("a settings-only live share executes restored values without first executing defaults", async () => {
  const settings = {
    foreground: "#000000",
    background: "#FFFFFF",
    canvas: "#111111",
    sample: "Shared heading",
    bodySample: "Shared body\nSecond line",
  };
  share(contrastSpec, { input: { text: "" }, settings });
  await mount(contrastSpec, "contrast-checker");
  await tick(1000);
  expect(document.querySelector('output[aria-label="Error"]').textContent).toBe("");
  expect(document.querySelector('output[aria-label="Lifecycle"]').textContent).toBe("completed");
  expect(observed.contrastRun).toHaveBeenCalledTimes(1);
  expect(observed.contrastRun.mock.calls[0][0].settings).toEqual(settings);
  for (const [key, value] of Object.entries(settings)) expect(field(key).value).toBe(value);
  expect(JSON.parse(result())).toEqual(runContrast({ settings }));
});

test("manual source edits clear the old share and wait for Run before the 300ms URL update", async () => {
  share(slugSpec, { input: { text: "Old Result" }, settings: {} });
  await mount(slugSpec, "slug-generator");
  await tick(1000);
  expect(observed.slugRun).toHaveBeenCalledTimes(1);
  await fill(field("Source"), "New Result");
  expect(window.location.hash).toBe("");
  await tick(1000);
  expect(observed.slugRun).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe("");

  await fill(field("Source"), "Final Result");
  await click(button("Generate slugs"));
  await settle();
  expect(observed.slugRun).toHaveBeenCalledTimes(2);
  expect(result()).toContain("final-result");
  await tick(299);
  expect(window.location.hash).toBe("");
  await tick(1);
  expect(decodeToolShare(slugSpec, window.location.hash).state.input.text).toBe("Final Result");
});

test("reset clears a settings-only share and does not recreate a default share after the live run", async () => {
  const settings = Object.fromEntries(
    Object.entries(contrastSpec.settings.fields).map(([key, value]) => [key, value.default]),
  );
  share(contrastSpec, { input: { text: "" }, settings: { ...settings, foreground: "#000000", sample: "Reset me" } });
  await mount(contrastSpec, "contrast-checker");
  await tick(1000);
  expect(window.location.hash).toMatch(/^#share=/);
  await click(button("Reset"));
  expect(window.location.hash).toBe("");
  await tick(1000);
  expect(window.location.hash).toBe("");
  expect(field("sample").value).toBe(settings.sample);
  expect(field("foreground").value).toBe(settings.foreground);
});
