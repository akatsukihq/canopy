import { toolSpec } from "./helpers/toolSpec.mjs";
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import React, { act } from "react";
import { createTranslator } from "next-intl";
import { getCommonMessages } from "../lib/i18n/messages.ts";
import { beforeEach, expect, test, vi } from "vitest";
import { ImageConversionWorkspace } from "../app/media/components/ImageConversionWorkspace.tsx";
const pngJpg = await toolSpec("png-to-jpg");
const pngWebp = await toolSpec("png-to-webp");
import { readArtifact } from "../lib/tool-framework/artifacts.ts";
import { button, click, field, fill, mountTool, setupReactTools, waitFor } from "./helpers/react-tools.mjs";

vi.mock("../lib/tool-framework/artifacts.ts", async (original) => ({ ...(await original()), readArtifact: vi.fn() }));
setupReactTools();
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
        const url = `blob:conversion-${objectUrls.size}`;
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

function source(name = "source.png") {
  return new File(["source"], name, { type: "image/png" });
}
function artifact(name, mime = "image/jpeg") {
  const blob = new Blob([name], { type: mime });
  return { storage: "blob", id: name, jobId: "conversion-test", name, mime, size: blob.size, createdAt: 0, blob };
}
function result(files) {
  return { render: "files", files };
}
async function mountWorkspace(overrides = {}, i18n = {}) {
  const onInputChange = vi.fn();
  const onSettingChange = vi.fn();
  const onToolbarActionsChange = vi.fn();
  const onValidationChange = vi.fn();
  const onRun = vi.fn();
  const onCancel = vi.fn();
  let props = {
    spec: pngJpg,
    conversions: [pngJpg, pngWebp],
    settings: { quality: 80, background: "#ffffff" },
    input: { text: "", files: [source()] },
    result: null,
    lifecycle: "ready",
    onInputChange,
    onSettingChange,
    onToolbarActionsChange,
    onValidationChange,
    primaryAction: { onRun, onCancel, disabled: false },
    ...overrides,
  };
  const element = () => React.createElement(ImageConversionWorkspace, props);
  const view = await mountTool(element(), { spec: props.spec, ...i18n });
  return {
    ...view,
    onInputChange,
    onSettingChange,
    onToolbarActionsChange,
    onValidationChange,
    onRun,
    onCancel,
    async update(next) {
      props = { ...props, ...next };
      await view.rerender(element());
    },
  };
}

function region(view, name) {
  return [...view.container.querySelectorAll("section[aria-labelledby]")].find(
    (el) => document.getElementById(el.getAttribute("aria-labelledby"))?.textContent === name,
  );
}

test("input and waiting output remain available and processing can be cancelled without losing sources", async () => {
  const view = await mountWorkspace();
  expect(region(view, "Processed output").textContent).toContain("Converted images will appear here");
  expect(button("Download", view.container).disabled).toBe(true);
  expect(button("Remove source.png", view.container)).toBeTruthy();
  expect(view.onToolbarActionsChange).toHaveBeenLastCalledWith({
    primaryActionLabel: "Convert to JPG",
    onCancel: expect.any(Function),
  });
  await view.update({ running: true, progress: { completed: 1, total: 2, stage: "Encoding" } });
  expect(region(view, "Processed output").textContent).toContain("Encoding");
  expect(button("Remove source.png", view.container).disabled).toBe(true);
  await click(button("Cancel", view.container));
  expect(view.onCancel).toHaveBeenCalledOnce();
  await view.update({ running: false });
  expect(region(view, "Processed output").textContent).toContain("Conversion cancelled");
  await click(button("Retry conversion", view.container));
  expect(view.onRun).toHaveBeenCalledOnce();
  expect(view.onInputChange).not.toHaveBeenCalled();
});

test("toolbar cancellation preserves sources and shows the same recovery as output cancellation", async () => {
  const view = await mountWorkspace({ running: true, progress: { completed: 1, total: 2, stage: "Encoding" } });
  const toolbarCancel = view.onToolbarActionsChange.mock.lastCall[0].onCancel;
  await act(async () => toolbarCancel());
  expect(view.onCancel).toHaveBeenCalledOnce();
  await view.update({ running: false, progress: null });
  expect(region(view, "Processed output").textContent).toContain("Conversion cancelled.");
  expect(region(view, "Processed output").textContent).toContain("Your images and settings are kept.");
  expect(button("Remove source.png", view.container).disabled).toBe(false);
  await click(button("Retry conversion", view.container));
  expect(view.onRun).toHaveBeenCalledOnce();
  expect(view.onInputChange).not.toHaveBeenCalled();
});

test("a single converted image downloads exact bytes and keeps editable source previews", async () => {
  const jpg = artifact("converted.jpg");
  const view = await mountWorkspace({ result: result([jpg]) });
  expect(button("Remove source.png", view.container)).toBeTruthy();
  expect(button("Preview converted.jpg", view.container)).toBeTruthy();
  await click(button("Download converted.jpg", view.container));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads[0].name).toBe("converted.jpg");
  expect(await downloads[0].blob.text()).toBe("converted.jpg");
  await click(button("Remove source.png", view.container));
  expect(view.onInputChange).toHaveBeenCalledWith({ text: "", files: [] });
});

test("batch ZIP and individual downloads remain usable after a failed update but lock while running", async () => {
  const jpgs = [artifact("one.jpg"), artifact("two.jpg")];
  const zip = artifact("images.zip", "application/zip");
  const view = await mountWorkspace({ result: result([...jpgs, zip]) });
  await click(button("Download ZIP images.zip", view.container));
  await click(button("Download one.jpg", view.container));
  await waitFor(() => expect(downloads.map((entry) => entry.name)).toEqual(["images.zip", "one.jpg"]));
  await view.update({ running: true });
  expect(button("Download ZIP images.zip", view.container).disabled).toBe(true);
  expect(button("Download two.jpg", view.container).disabled).toBe(true);
  expect(button("Convert more", view.container).disabled).toBe(true);
  await view.update({ running: false, error: "Encoding failed" });
  expect(region(view, "Processed output").textContent).toContain("Your previous output is still available");
  expect(button("Download ZIP images.zip", view.container).disabled).toBe(false);
  await click(button("Retry conversion", view.container));
  expect(view.onRun).toHaveBeenCalledOnce();
});

test("format changes preserve sources and map each format's settings to its own keys", async () => {
  const view = await mountWorkspace({ result: result([artifact("converted.jpg")]) });
  await click(button("Restore settings panel", view.container));
  await click(field("Output format", view.container));
  await click([...document.querySelectorAll('[role="option"]')].find((item) => item.textContent === "WebP"));
  expect(view.onSettingChange).toHaveBeenLastCalledWith("imageOutputFormat", "webp");
  expect(view.onInputChange).not.toHaveBeenCalled();
  await view.update({ settings: { quality: 80, background: "#ffffff", imageOutputFormat: "webp" } });
  expect(view.onToolbarActionsChange).toHaveBeenLastCalledWith({
    primaryActionLabel: "Convert to WebP",
    onCancel: expect.any(Function),
  });
  await fill(field("Quality", view.container), "70");
  expect(view.onSettingChange).toHaveBeenLastCalledWith("conversion.webp.quality", 70);
  await view.update({
    settings: { quality: 80, background: "#ffffff", imageOutputFormat: "webp", "conversion.webp.quality": 1 },
  });
  expect(view.onValidationChange).toHaveBeenLastCalledWith(expect.stringContaining("Quality must be between"));
});

test("Convert more clears sources and restores tool defaults", async () => {
  const view = await mountWorkspace({ result: result([artifact("converted.jpg")]) });
  await click(button("Convert more", view.container));
  expect(view.onInputChange).toHaveBeenCalledWith({ files: [], text: "" });
  expect(view.onSettingChange).toHaveBeenCalledWith("quality", 80);
  expect(view.onSettingChange).toHaveBeenCalledWith("background", "#ffffff");
});

test("Paste appends supported clipboard images and ignores stale clipboard results after inputs change", async () => {
  const read = vi
    .fn()
    .mockResolvedValue([{ types: ["image/png"], getType: async () => new Blob(["clipboard"], { type: "image/png" }) }]);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read } });
  const view = await mountWorkspace();
  await click(button("Paste", view.container));
  expect(view.onInputChange).toHaveBeenCalledWith(
    expect.objectContaining({
      files: expect.arrayContaining([
        expect.objectContaining({ name: "source.png" }),
        expect.objectContaining({ name: "pasted-image-2.png", type: "image/png" }),
      ]),
    }),
  );
  let resolve;
  read.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  view.onInputChange.mockClear();
  await click(button("Paste", view.container));
  await view.update({ input: { text: "", files: [] } });
  await act(async () =>
    resolve([{ types: ["image/png"], getType: async () => new Blob(["stale"], { type: "image/png" }) }]),
  );
  expect(view.onInputChange).not.toHaveBeenCalled();
});

test("choosing the current format preserves database-edited source labels", async () => {
  const spec = {
    ...pngJpg,
    trigger: { mode: "manual", actionLabel: "Create edited JPG" },
    settings: {
      ...pngJpg.settings,
      fields: {
        ...pngJpg.settings.fields,
        quality: { ...pngJpg.settings.fields.quality, label: "Saved quality label" },
      },
    },
  };
  const view = await mountWorkspace({
    spec,
    settings: { quality: 80, background: "#ffffff", imageOutputFormat: "jpg" },
  });
  expect(view.onToolbarActionsChange.mock.lastCall[0].primaryActionLabel).toBe("Create edited JPG");
  expect(field("Saved quality label", view.container)).toBeTruthy();
  expect(view.container.textContent).toContain("Download the converted JPG file here.");
});

test("alternate conversion uses the current tool's localized messages and stable setting keys", async () => {
  const view = await mountWorkspace(
    { settings: { quality: 80, background: "#ffffff", imageOutputFormat: "webp" } },
    {
      locale: "hi",
      messages: {
        "runtime.conversion.action": "{format} में बदलें",
        "runtime.conversion.running": "इमेज {format} में बदल रही हैं…",
        "runtime.conversion.qualityLabel": "गुणवत्ता",
        "runtime.conversion.qualityHelp": "{format, select, jpg {JPG गुणवत्ता चुनें।} other {WebP गुणवत्ता चुनें।}}",
      },
    },
  );
  expect(view.onToolbarActionsChange.mock.lastCall[0].primaryActionLabel).toBe("WebP में बदलें");
  expect(view.container.textContent).toContain("WebP गुणवत्ता चुनें।");
  const t = createTranslator({ locale: "hi", namespace: "Workbench", messages: getCommonMessages("hi") });
  await click(button(t("restorePanel", { panel: t("settingsPanel") }), view.container));
  await fill(field("गुणवत्ता", view.container), "70");
  expect(view.onSettingChange).toHaveBeenLastCalledWith("conversion.webp.quality", 70);
  await view.update({ running: true });
  expect(view.container.textContent).toContain("इमेज WebP में बदल रही हैं…");
  expect(view.onInputChange).not.toHaveBeenCalled();
});
