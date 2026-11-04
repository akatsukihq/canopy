import { allToolSpecs, toolSpec } from "./helpers/toolSpec.mjs";
import { File } from "node:buffer";
import { expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import { parseSettings } from "../lib/tool-framework/settings.ts";
import { ToolError, translateToolError } from "../lib/tool-framework/run.ts";
import { extractToolMessages, formatToolMessage, validateToolTranslation } from "../lib/tool-framework/translations.ts";
import { validateMediaSignature, validatePdfSelection } from "../lib/tool-framework/media/validation.ts";
import { checkedPages } from "../lib/tool-framework/media/pdfDocument.ts";
import { splitPageGroups } from "../tools/split-pdf/groups.ts";
const splitSpec = await toolSpec("split-pdf");
const reorderSpec = await toolSpec("reorder-pdf-pages");
const watermarkSpec = await toolSpec("watermark-pdf");
const compressSpec = await toolSpec("compress-pdf");
const imagePdfSpec = await toolSpec("image-to-pdf");
const cropSpec = await toolSpec("crop-image");
const cropPdfSpec = await toolSpec("crop-pdf");
const deleteSpec = await toolSpec("delete-pdf-pages");
import reorderPdf from "../tools/reorder-pdf-pages/run.worker.ts";
import watermarkPdf from "../tools/watermark-pdf/run.worker.ts";
import compressPdf from "../tools/compress-pdf/run.worker.ts";
import imageToPdf from "../tools/image-to-pdf/run.worker.ts";
import { validate as compressReady } from "../tools/compress-pdf/hooks.ts";
import { validate as cropReady } from "../tools/crop-image/hooks.ts";
import { validate as cropPdfReady } from "../tools/crop-pdf/hooks.ts";
import { validate as deleteReady } from "../tools/delete-pdf-pages/hooks.ts";
import { validate as watermarkReady } from "../tools/watermark-pdf/hooks.ts";
import { parseCropPoints } from "../tools/crop-image/geometry.ts";
import { cropPlan } from "../tools/crop-pdf/plan.ts";

function translator(spec, locale = "en", overrides = {}) {
  const messages = { ...extractToolMessages(spec), ...overrides };
  return (ref) => {
    const message = messages[`runtime.${ref.key}`];
    expect(message, `missing declared message ${ref.key}`).toBeTypeOf("string");
    return formatToolMessage(locale, message, ref.values);
  };
}
async function failure(action) {
  try {
    await action();
  } catch (error) {
    expect(error, error.stack).toBeInstanceOf(ToolError);
    return error;
  }
  throw new Error("Expected the operation to reject its input");
}
function context(settings, files = []) {
  return {
    settings,
    input: { text: "", files },
    signal: new AbortController().signal,
    progress() {},
    async writeArtifact() {
      throw new Error("Invalid input must not create output");
    },
  };
}
async function pdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([100, 200]);
  doc.addPage([300, 400]);
  const bytes = await doc.save();
  const source = new File([bytes], "source.pdf", { type: "application/pdf" });
  return { id: "source", name: source.name, mime: source.type, size: source.size, source };
}

const mediaDefinitions = (await allToolSpecs()).filter((spec) => spec.app === "media");
const mediaWorkers = import.meta.glob("../tools/*/run.worker.ts");

test("every Media tool has a publishable native ICU contract and a declared empty-input failure", async () => {
  expect(mediaDefinitions.length).toBeGreaterThan(0);
  for (const spec of mediaDefinitions) {
    const source = extractToolMessages(spec);
    expect(validateToolTranslation("en", source, source, { publish: true }), spec.toolId).toEqual([]);
    const worker = await mediaWorkers[`../tools/${spec.toolId.split(".")[1]}/run.worker.ts`]();
    const error = await failure(() => worker.run(context(parseSettings(spec.settings, {}))));
    expect(translator(spec)(error.details.messageRef)).toBe(error.message);
  }
});

test("shared limits and page failures retain semantic parameters through translation", async () => {
  const limit = validatePdfSelection([{ size: 10 }], { pageCount: 501 });
  expect(limit.ok).toBe(false);
  expect(translator(splitSpec)(limit.details.messageRef)).toBe(limit.message);
  const error = await failure(() => splitPageGroups({ mode: "ranges", ranges: "9", interval: 1 }, 3));
  expect(error.code).toBe("page-out-of-range");
  expect(error.details.messageRef.values).toEqual({ count: 3 });
  const localized = translateToolError(
    error,
    translator(splitSpec, "hi", {
      "runtime.media.parsePageRange.pageOutOfRange": "1 से {count, number} के बीच पृष्ठ चुनें।",
    }),
    () => undefined,
  );
  expect(localized.message).toBe("1 से 3 के बीच पृष्ठ चुनें।");
  expect(localized.details).toEqual(error.details);
  const duplicate = await failure(() => checkedPages([2, 2], 3));
  expect(translator(reorderSpec)(duplicate.details.messageRef)).toBe(duplicate.message);
  const signature = validateMediaSignature(new Uint8Array([255, 216, 255]), "image/png");
  expect(translator(cropSpec)(signature.details.messageRef)).toBe(signature.message);
});

test("the reorder and watermark adapters reject invalid jobs with their own message references", async () => {
  const input = await pdfFile();
  for (const [spec, run, settings, code] of [
    [reorderSpec, reorderPdf, { pages: "all" }, "incomplete-order"],
    [watermarkSpec, watermarkPdf, { pages: "all", watermarkKind: "text", watermarkText: " " }, "empty-watermark"],
    [watermarkSpec, watermarkPdf, { pages: "all", watermarkKind: "image" }, "missing-watermark"],
  ]) {
    const error = await failure(() => run(context(settings, [input])));
    expect(error.code).toBe(code);
    expect(translator(spec)(error.details.messageRef)).toBe(error.message);
  }
});

test("preflight recovery instructions survive compression and image-to-PDF failures", async () => {
  for (const [spec, run, settings, files] of [
    [compressSpec, compressPdf, { mode: "strong" }, [{ size: 52_428_801, source: {} }]],
    [imagePdfSpec, imageToPdf, {}, [{ size: 52_428_801, source: {} }]],
  ]) {
    const error = await failure(() => run(context(settings, files)));
    const translated = translateToolError(error, translator(spec), () => undefined);
    expect(translated.message).toBe(error.message);
    expect(translated.recovery).toBe(error.recovery);
    expect(error.details.recoveryMessage).toBeDefined();
  }
});

test("all first-party readiness hooks expose a declared message while preserving their ready state", () => {
  const examples = [
    [compressSpec, compressReady, { mode: "strong", confirmed: false }, { mode: "strong", confirmed: true }],
    [
      cropSpec,
      cropReady,
      { cropMode: "rectangle", cropWidth: 0, cropHeight: 10 },
      { cropMode: "rectangle", cropWidth: 10, cropHeight: 10 },
    ],
    [
      cropPdfSpec,
      cropPdfReady,
      { cropX: 0.5, cropY: 0, cropWidth: 10, cropHeight: 10 },
      { cropX: 0, cropY: 0, cropWidth: 10, cropHeight: 10 },
    ],
    [deleteSpec, deleteReady, { pages: "" }, { pages: "1" }],
    [watermarkSpec, watermarkReady, { watermarkKind: "image" }, { watermarkKind: "text" }],
  ];
  for (const [spec, validate, invalid, valid] of examples) {
    const issue = validate(invalid, []);
    expect(translator(spec)(issue.messageRef)).toBe(issue.message);
    expect(validate(valid, [])).toBe(null);
  }
});

test("crop geometry failures retain their page and coordinate meaning for localized plans", async () => {
  const polygon = await failure(() => parseCropPoints("invalid"));
  expect(translator(cropSpec)(polygon.details.messageRef)).toBe(polygon.message);
  const plan = await failure(() =>
    cropPlan({ pages: "all", cropX: 0, cropY: 0, cropWidth: 200, cropHeight: 100 }, [
      { pageNumber: 2, pageWidth: 100, pageHeight: 100 },
    ]),
  );
  expect(plan.details.messageRef.values).toEqual({ page: 2 });
  expect(translator(cropPdfSpec)(plan.details.messageRef)).toBe(plan.message);
});

test("translated progress references leave the actual reordered PDF pages unchanged", async () => {
  const input = await pdfFile();
  const progress = [];
  let written;
  const result = await reorderPdf({
    ...context({ pages: [2, 1] }, [input]),
    progress(update) {
      progress.push(update);
    },
    async writeArtifact(file) {
      written = file;
      return { ...file, id: "result", size: file.source.byteLength };
    },
  });
  expect(result.render).toBe("files");
  expect(written.name).toBe("source-reordered.pdf");
  const output = await PDFDocument.load(written.source);
  expect(output.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
    [300, 400],
    [100, 200],
  ]);
  expect(progress.map((p) => [p.completed, p.total])).toEqual([
    [0, 2],
    [1, 2],
    [1, 2],
    [2, 2],
  ]);
  for (const update of progress) expect(translator(reorderSpec)(update.stageMessage)).toBe(update.stage);
});
