import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { FileProcessorWorkspace } from "../components/FileProcessorWorkspace.tsx";
import { readArtifact } from "../lib/tool-framework/artifacts.ts";
const splitPdfSpec = await toolSpec("split-pdf");
const compressImageSpec = await toolSpec("compress-image");
import { button, click, mountTool, setupReactTools, waitFor } from "./helpers/react-tools.mjs";

vi.mock("../lib/tool-framework/hooks.ts", () => ({ loadToolHooks: async () => ({}) }));
vi.mock("../lib/tool-framework/useToolRun.ts", () => {
  const handle = {
    closeInspection: () => {},
    inspect: () => {},
    previews: [],
    requestThumbnails: () => {},
    reset: () => {},
    state: { status: "idle" },
  };
  return { useToolRun: () => handle };
});
vi.mock("../lib/tool-framework/artifacts.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  readArtifact: vi.fn(),
}));
vi.mock("../components/GeneratedPdfPreview.tsx", () => ({ GeneratedPdfPreview: () => null }));
vi.mock("../components/ResultView.tsx", () => ({ ResultView: () => null }));

setupReactTools();

const spec = {
  ...splitPdfSpec,
  optionsPanel: { collapsible: false },
  settings: { fields: {} },
};
const imageSpec = { ...compressImageSpec, settings: { fields: {} } };
const tools = [
  { name: "PDF", spec, filename: "source.pdf", mime: "application/pdf" },
  { name: "image", spec: imageSpec, filename: "source.png", mime: "image/png" },
];
let downloads;
let objectUrls;

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  downloads = [];
  objectUrls = new Map();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        const url = `blob:output-test-${objectUrls.size + 1}`;
        objectUrls.set(url, blob);
        return url;
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push({ name: this.download, blob: objectUrls.get(this.href) });
  });
  vi.mocked(readArtifact).mockReset();
  vi.mocked(readArtifact).mockImplementation(async (file) => new File([file.blob], file.name, { type: file.mime }));
});

function artifact(name, content = "%PDF-output", mime = "application/pdf") {
  const blob = new Blob([content], { type: mime });
  return {
    storage: "blob",
    id: name.replaceAll(".", "-"),
    jobId: "output-test",
    name,
    mime,
    size: blob.size,
    createdAt: 0,
    blob,
  };
}

// The page owns the primary action unless the workspace explicitly takes it.
function WorkspaceWithToolbar(props) {
  const [actions, setActions] = React.useState(null);
  return React.createElement(
    React.Fragment,
    null,
    !actions?.primaryActionInWorkspace &&
      React.createElement(
        "div",
        { role: "toolbar", "aria-label": "Tool actions" },
        React.createElement(
          "button",
          {
            onClick: props.primaryAction.running
              ? (actions?.onCancel ?? props.primaryAction.onCancel)
              : props.primaryAction.onRun,
            disabled: !props.primaryAction.running && (props.disabled || props.primaryAction.disabled),
          },
          props.primaryAction.running ? "Cancel" : (actions?.primaryActionLabel ?? props.primaryAction.label),
        ),
      ),
    React.createElement(FileProcessorWorkspace, { ...props, onToolbarActionsChange: setActions }),
  );
}

async function mountWorkspace(overrides = {}) {
  const onRun = vi.fn();
  const onCancel = vi.fn();
  const onInputChange = vi.fn();
  const selectedSpec = overrides.spec ?? spec;
  const source = tools.find((tool) => tool.spec === selectedSpec) ?? tools[0];
  let props = {
    spec,
    settings: {},
    input: { text: "", secondary: "", files: [new File(["source"], source.filename, { type: source.mime })] },
    result: null,
    lifecycle: "ready",
    onInputChange,
    onSettingChange: () => {},
    ...overrides,
  };
  const element = () =>
    React.createElement(WorkspaceWithToolbar, {
      ...props,
      primaryAction: {
        disabled: false,
        label: props.spec.trigger.actionLabel,
        onRun,
        onCancel,
        running: props.running ?? false,
      },
    });
  const view = await mountTool(element());
  return {
    ...view,
    onRun,
    onCancel,
    onInputChange,
    async update(next) {
      props = { ...props, ...next };
      await view.rerender(element());
    },
  };
}

function outputRegion(workspace) {
  const output = [...workspace.container.querySelectorAll("section[aria-labelledby]")].find((region) => {
    const label = region
      .getAttribute("aria-labelledby")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    return label === "Processed output";
  });
  expect(output, "The processed output must remain available before and after a run").toBeTruthy();
  return output;
}

function downloadButtons(scope) {
  return [...scope.querySelectorAll("button")].filter((element) =>
    /^(?:Download|Retry download)/i.test(element.getAttribute("aria-label") ?? element.textContent.trim()),
  );
}

test.each(tools)("empty $name input has an output waiting state that explains how to begin", async ({ spec }) => {
  const workspace = await mountWorkspace({ spec, input: { text: "", secondary: "", files: [] }, lifecycle: "empty" });
  const output = outputRegion(workspace);
  expect(output.textContent).toContain("Result will appear here");
  expect(output.textContent).toContain(spec.labels.empty);
  const download = button("Download", output);
  expect(download.disabled).toBe(true);
  await click(download);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(downloads).toHaveLength(0);
});

test.each(tools)(
  "running $name output announces progress and cancellation preserves the input for another run",
  async ({ spec, filename }) => {
    const workspace = await mountWorkspace({
      spec,
      lifecycle: "running",
      running: true,
      progress: { completed: 1, total: 4, stage: "Copying pages" },
    });
    const output = outputRegion(workspace);
    expect(output.textContent).toContain("25%");
    expect(output.textContent).toContain("Working on item 2 of 4");
    expect(output.textContent).toContain("Copying pages");
    await click(button("Cancel", output));
    expect(workspace.onCancel).toHaveBeenCalledOnce();

    await workspace.update({ running: false, lifecycle: "ready", progress: null });
    expect(outputRegion(workspace).textContent).toContain("Processing cancelled");
    expect(outputRegion(workspace).textContent).toContain("Your input files are unchanged. Run again when ready.");
    expect(button(`Remove ${filename}`, workspace.container)).toBeTruthy();
    expect(workspace.onInputChange).not.toHaveBeenCalled();
    await click(button(spec.trigger.actionLabel, workspace.container));
    expect(workspace.onRun).toHaveBeenCalledOnce();

    await workspace.update({ running: true, lifecycle: "running" });
    expect(outputRegion(workspace).textContent).not.toContain("Processing cancelled");
    expect(outputRegion(workspace).textContent).toContain(spec.labels.running);
    expect(button("Cancel", outputRegion(workspace))).toBeTruthy();
  },
);

test.each(tools)(
  "cancelling $name processing from the toolbar preserves input and explains recovery",
  async ({ spec, filename }) => {
    const workspace = await mountWorkspace({ spec, lifecycle: "running", running: true });
    const toolbar = workspace.container.querySelector('[role="toolbar"][aria-label="Tool actions"]');
    await click(button("Cancel", toolbar));
    expect(workspace.onCancel).toHaveBeenCalledOnce();
    expect(workspace.onRun).not.toHaveBeenCalled();

    await workspace.update({ lifecycle: "ready", running: false });
    const output = outputRegion(workspace);
    expect(output.textContent).toContain("Processing cancelled");
    expect(output.textContent).toContain("Your input files are unchanged. Run again when ready.");
    expect(button(`Remove ${filename}`, workspace.container)).toBeTruthy();
    expect(workspace.onInputChange).not.toHaveBeenCalled();
    await click(button(spec.trigger.actionLabel, toolbar));
    expect(workspace.onRun).toHaveBeenCalledOnce();
  },
);

test.each(tools)("an unsuccessful $name run explains the failure and allows another attempt", async ({ spec }) => {
  const workspace = await mountWorkspace({ spec, lifecycle: "failed", error: "The source file could not be read." });
  const output = outputRegion(workspace);
  expect(output.textContent).toContain("Unable to create the result");
  expect(output.textContent).toContain("The source file could not be read.");
  expect(button("Download", output).disabled).toBe(true);
  await click(button(spec.trigger.actionLabel, workspace.container));
  expect(workspace.onRun).toHaveBeenCalledOnce();

  await workspace.update({ running: true, lifecycle: "running", error: undefined });
  expect(outputRegion(workspace).textContent).not.toContain("The source file could not be read.");
  expect(button("Cancel", outputRegion(workspace))).toBeTruthy();
});

test("a single PDF has one download that preserves its exact bytes and filename", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 255, 127]);
  const file = artifact("finished.pdf", bytes);
  const workspace = await mountWorkspace({ result: { render: "files", files: [file] }, lifecycle: "completed" });
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(1);
  expect(actions[0].disabled).toBe(false);
  await click(actions[0]);
  expect(readArtifact).toHaveBeenCalledExactlyOnceWith(file);
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toBe("finished.pdf");
  expect(new Uint8Array(await downloads[0].blob.arrayBuffer())).toEqual(bytes);
  expect(downloads[0].blob.type).toBe("application/pdf");
});

test("a single compressed image downloads its exact bytes and stays protected during a replacement run", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 127]);
  const file = artifact("compressed.png", bytes, "image/png");
  const workspace = await mountWorkspace({ spec: imageSpec, result: { render: "files", files: [file] } });
  vi.mocked(readArtifact).mockClear();
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(1);
  await click(actions[0]);
  expect(readArtifact).toHaveBeenCalledExactlyOnceWith(file);
  expect(downloads[0].name).toBe("compressed.png");
  expect(new Uint8Array(await downloads[0].blob.arrayBuffer())).toEqual(bytes);
  expect(downloads[0].blob.type).toBe("image/png");

  vi.mocked(readArtifact).mockClear();
  await workspace.update({ lifecycle: "running", running: true });
  const download = downloadButtons(outputRegion(workspace))[0];
  expect(download.disabled).toBe(true);
  await click(download);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(downloads).toHaveLength(1);

  await workspace.update({ lifecycle: "failed", running: false, error: "Image compression failed." });
  expect(outputRegion(workspace).textContent).toContain("Your previous output is still available");
  await click(downloadButtons(outputRegion(workspace))[0]);
  expect(downloads.map((entry) => entry.name)).toEqual(["compressed.png", "compressed.png"]);
});

test("compressed images can be downloaded individually or together as the ZIP bundle", async () => {
  const files = [
    artifact("first-compressed.png", "first image", "image/png"),
    artifact("second-compressed.webp", "second image", "image/webp"),
    artifact("compressed-images.zip", new Uint8Array([80, 75, 3, 4, 0, 255]), "application/zip"),
  ];
  const workspace = await mountWorkspace({ spec: imageSpec, result: { render: "files", files } });
  vi.mocked(readArtifact).mockClear();
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(3);
  for (const action of actions) await click(action);
  expect(downloads.map((download) => download.name).sort()).toEqual(files.map((file) => file.name).sort());
  for (const file of files) {
    const download = downloads.find((entry) => entry.name === file.name);
    expect(new Uint8Array(await download.blob.arrayBuffer())).toEqual(new Uint8Array(await file.blob.arrayBuffer()));
    expect(download.blob.type).toBe(file.mime);
  }

  vi.mocked(readArtifact).mockClear();
  await workspace.update({ lifecycle: "running", running: true });
  for (const action of downloadButtons(outputRegion(workspace))) {
    expect(action.disabled).toBe(true);
    await click(action);
  }
  expect(readArtifact).not.toHaveBeenCalled();
});

test("removing the last image restores the output waiting state without leaving a stale download", async () => {
  const file = artifact("compressed.png", "compressed image", "image/png");
  const workspace = await mountWorkspace({ spec: imageSpec, result: { render: "files", files: [file] } });
  await click(button("Remove source.png", workspace.container));
  expect(workspace.onInputChange).toHaveBeenCalledExactlyOnceWith({ text: "", secondary: "", files: [] });

  // The page clears the result when accepting a changed input.
  await workspace.update({ input: workspace.onInputChange.mock.calls[0][0], result: null, lifecycle: "empty" });
  const output = outputRegion(workspace);
  expect(output.textContent).toContain("Result will appear here");
  expect(output.textContent).toContain(imageSpec.labels.empty);
  vi.mocked(readArtifact).mockClear();
  const actions = downloadButtons(output);
  expect(actions).toHaveLength(1);
  expect(actions[0].disabled).toBe(true);
  await click(actions[0]);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(downloads).toHaveLength(0);
});

test("a retained PDF cannot be downloaded while a replacement is running", async () => {
  const file = artifact("previous.pdf");
  const workspace = await mountWorkspace({ result: { render: "files", files: [file] } });
  await workspace.update({ lifecycle: "running", running: true });
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(1);
  expect(actions[0].disabled).toBe(true);
  await click(actions[0]);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(downloads).toHaveLength(0);

  await workspace.update({ lifecycle: "failed", running: false, error: "The update failed." });
  expect(outputRegion(workspace).textContent).toContain("Your previous output is still available");
  expect(downloadButtons(outputRegion(workspace))[0].disabled).toBe(false);
  await click(downloadButtons(outputRegion(workspace))[0]);
  expect(downloads[0].name).toBe("previous.pdf");
});

test("a ZIP bundle and every individual PDF remain independently downloadable", async () => {
  const files = [
    artifact("source-part-01.pdf", "first part"),
    artifact("source-part-02.pdf", "second part"),
    artifact("split-pdfs.zip", new Uint8Array([80, 75, 3, 4, 0, 255]), "application/zip"),
  ];
  const workspace = await mountWorkspace({ result: { render: "files", files } });
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(3);
  for (const action of actions) await click(action);
  expect(downloads.map((download) => download.name).sort()).toEqual(files.map((file) => file.name).sort());
  for (const file of files) {
    const download = downloads.find((entry) => entry.name === file.name);
    expect(new Uint8Array(await download.blob.arrayBuffer())).toEqual(new Uint8Array(await file.blob.arrayBuffer()));
    expect(download.blob.type).toBe(file.mime);
  }

  vi.mocked(readArtifact).mockClear();
  await workspace.update({ lifecycle: "running", running: true });
  for (const action of downloadButtons(outputRegion(workspace))) {
    expect(action.disabled).toBe(true);
    await click(action);
  }
  expect(readArtifact).not.toHaveBeenCalled();
});

test("replacing or removing a result removes access to its previous download", async () => {
  const first = artifact("first.pdf", "first");
  const replacement = artifact("replacement.pdf", "replacement");
  const workspace = await mountWorkspace({ result: { render: "files", files: [first] } });
  await workspace.update({ result: { render: "files", files: [replacement] } });
  const actions = downloadButtons(outputRegion(workspace));
  expect(actions).toHaveLength(1);
  await click(actions[0]);
  expect(readArtifact).toHaveBeenCalledExactlyOnceWith(replacement);
  expect(downloads.map((download) => download.name)).toEqual(["replacement.pdf"]);

  vi.mocked(readArtifact).mockClear();
  await workspace.update({ result: null, lifecycle: "ready" });
  const download = button("Download", outputRegion(workspace));
  expect(download.disabled).toBe(true);
  await click(download);
  expect(readArtifact).not.toHaveBeenCalled();
  expect(downloads.map((download) => download.name)).toEqual(["replacement.pdf"]);
  expect(outputRegion(workspace).textContent).toContain("Result will appear here");
});

test.each(tools)(
  "an unavailable stored $name can be retried without rerunning the tool",
  async ({ spec, filename, mime }) => {
    const file = artifact(filename, "recovered output", mime);
    const workspace = await mountWorkspace({ spec, result: { render: "files", files: [file] } });
    vi.mocked(readArtifact).mockClear();
    vi.mocked(readArtifact).mockRejectedValueOnce(new Error("Storage unavailable"));
    await click(downloadButtons(outputRegion(workspace))[0]);
    await waitFor(() => expect(button(/^Retry download/, outputRegion(workspace))).toBeTruthy());
    expect(downloads).toHaveLength(0);
    await click(button(/^Retry download/, outputRegion(workspace)));
    expect(readArtifact).toHaveBeenCalledTimes(2);
    expect(downloads[0].name).toBe(filename);
    expect(await downloads[0].blob.text()).toBe("recovered output");
    expect(workspace.onRun).not.toHaveBeenCalled();
  },
);
