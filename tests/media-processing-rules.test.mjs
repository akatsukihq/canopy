import { allToolSpecs } from "./helpers/toolSpec.mjs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test } from "vitest";

const errorMatch = (error, matcher) => {
  if (matcher === undefined) return;
  if (typeof matcher === "function") {
    if (matcher.prototype instanceof Error || matcher === Error) expect(error).toBeInstanceOf(matcher);
    else expect(matcher(error)).toBeTruthy();
  } else if (matcher instanceof RegExp) expect(error.message).toMatch(matcher);
  else expect(error).toMatchObject(matcher);
};
function assertThrows(fn, matcher) {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error, "expected throw").toBeDefined();
  errorMatch(error, matcher);
}
async function assertRejects(input, matcher) {
  const promise = typeof input === "function" ? input() : input;
  let error;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, "expected rejection").toBeDefined();
  errorMatch(error, matcher);
}

import { TOOL_CATEGORIES } from "../lib/tool-framework/categories.ts";
import { QpdfAdapterError, buildQpdfArguments, preservePdfWithQpdf } from "../lib/tool-framework/media/qpdf.ts";
import {
  PdfPreflightError,
  assertStructuralPdfInspection,
  clipEndOperators,
  clipStartOperators,
  getPdfContentBox,
  hasTransparentPixels,
  inspectPdfBeforeStructuralRewrite,
  processStructuralPages,
} from "../lib/tool-framework/media/pdfRules.ts";

import {
  calculateResizeDimensions,
  fitRect,
  getExifOrientationTransform,
  normalizeCropRect,
  readExifOrientation,
  rotatedDimensions,
} from "../lib/tool-framework/media/geometry.ts";
import {
  MEDIA_LIMITS,
  createOutputFilename,
  createPageArchiveFilename,
  createPageOutputFilename,
  detectMediaKind,
  hasPdfDigitalSignature,
  parsePageRange,
  sanitizeBaseName,
  sanitizeFileName,
  validateDecodedImageDimensions,
  validateImageSelection,
  validateMediaSignature,
  validatePdfSelection,
} from "../lib/tool-framework/media/validation.ts";
import {
  INSPECT_THUMBNAIL_WIDTH,
  beginWorkerJob,
  cancelWorkerJob,
  createToolInspectionCloseRequest,
  createToolInspectRequest,
  createToolJobState,
  createToolRunFile,
  createToolThumbnailRequest,
  createToolWorkerRequest,
  isToolWorkerMessage,
  isToolWorkerResponse,
  reduceWorkerJobState,
} from "../lib/tool-framework/workerProtocol.ts";

const EXPECTED_TOOLS_BY_CATEGORY = {
  "PDF Conversion": ["image-to-pdf", "pdf-to-jpg", "pdf-to-png"],
  "PDF Organization": [
    "merge-pdf",
    "split-pdf",
    "extract-pdf-pages",
    "reorder-pdf-pages",
    "rotate-pdf-pages",
    "delete-pdf-pages",
    "crop-pdf",
    "resize-pdf-pages",
  ],
  "PDF Optimization": ["compress-pdf", "watermark-pdf", "add-page-numbers"],
  "Image Conversion": [
    "jpg-to-png",
    "png-to-jpg",
    "jpg-to-webp",
    "png-to-webp",
    "webp-to-jpg",
    "webp-to-png",
    "heic-to-jpg",
    "heic-to-png",
  ],
  "Image Editing": [
    "compress-image",
    "resize-image",
    "crop-image",
    "rotate-image",
    "flip-image",
    "combine-images",
    "remove-image-metadata",
    "social-media-image-resizer",
  ],
};

const requireFromMedia = createRequire(new URL("../package.json", import.meta.url));

const TOOLS_URL = new URL("../tools/", import.meta.url);

/**
 * The source of truth for what Media ships is the stored specs whose app is
 * `media`, keyed by their `tools/<folder>`. There is deliberately no second
 * catalogue to compare against.
 */
const mediaTools = (await allToolSpecs())
  .filter((spec) => spec.app === "media")
  .map((spec) => ({ folder: spec.toolId.split(".")[1], spec }));

const mediaToolByFolder = new Map(mediaTools.map((tool) => [tool.folder, tool.spec]));

async function toolSource(folder, file) {
  return readFile(new URL(`${folder}/${file}`, TOOLS_URL), "utf8");
}

test("the Media runtime defines exactly the public tool routes, one per folder", () => {
  const expected = Object.values(EXPECTED_TOOLS_BY_CATEGORY).flat();

  expect([...mediaToolByFolder.keys()].sort()).toEqual([...expected].sort());
  expect(mediaTools.length).toBe(expected.length);

  for (const [label, folders] of Object.entries(EXPECTED_TOOLS_BY_CATEGORY)) {
    expect(
      mediaTools
        .filter(({ spec }) => TOOL_CATEGORIES[spec.category].label === label)
        .map(({ folder }) => folder)
        .sort(),
      label,
    ).toEqual([...folders].sort());
  }

  for (const { folder, spec } of mediaTools) {
    expect(spec.toolId, folder).toBe(`media.${folder}`);
    expect(TOOL_CATEGORIES[spec.category].app, folder).toBe("media");
    expect(spec.name, folder).toMatch(/\S/);
    expect(spec.description, folder).toMatch(/\S/);
    expect(spec.input.kind, folder).toBe("files");
    expect(spec.input.accept, folder).toMatch(/^(application|image)\//);
    expect(spec.input.engine === "image" || spec.input.engine === "pdf", folder).toBeTruthy();
    expect(typeof (spec.input.multiple ?? false), folder).toBe("boolean");
  }
  expect(mediaToolByFolder.get("not-a-tool")).toBe(undefined);
});

test("every Media catalog entry resolves to exactly one runtime implementation", async () => {
  // The folder walk above is the catalogue. There is no bundled list left to
  // compare it against, and reintroducing one is what this suite exists to
  // prevent — so uniqueness is asserted on the folders themselves.
  const catalogKeys = mediaTools.map(({ spec }) => spec.toolId.split(".")[1]);

  expect([...catalogKeys].sort()).toEqual([...mediaToolByFolder.keys()].sort());
  expect(new Set(catalogKeys).size).toBe(catalogKeys.length);

  // One run module per folder, and it is the worker variant: every media tool
  // decodes bytes off the main thread.
  const runFiles = await Promise.all(
    mediaTools.map(async ({ folder }) => {
      const entries = await readdir(new URL(`${folder}/`, TOOLS_URL));
      return [folder, entries.filter((name) => /^run\.[a-z.]*ts$/.test(name))];
    }),
  );
  for (const [folder, files] of runFiles) {
    expect(files, folder).toEqual(["run.worker.ts"]);
  }

  // The image/pdf engine split is total and disjoint, which is what the old
  // IMAGE_WORKER_OPERATIONS / PDF_WORKER_OPERATIONS partition guaranteed.
  const byEngine = { image: [], pdf: [] };
  for (const { folder, spec } of mediaTools) byEngine[spec.input.engine].push(folder);
  expect(byEngine.image.filter((folder) => byEngine.pdf.includes(folder))).toEqual([]);
  expect(byEngine.image.length + byEngine.pdf.length).toBe(mediaTools.length);
});

test("crop rejects HEIC at the public input boundary", () => {
  const crop = mediaToolByFolder.get("crop-image");

  expect(crop).toBeTruthy();
  expect(crop.input.accept).not.toMatch(/image\/hei[cf]/);
  expect(crop.input.accept).toMatch(/image\/jpeg/);
  expect(crop.input.accept).toMatch(/image\/png/);
  expect(crop.input.accept).toMatch(/image\/webp/);
  expect(crop.input.multiple ?? false).toBe(false);
});

test("the tool worker uses the classic runtime emitted by the production build", async () => {
  const source = await readFile(new URL("../lib/tool-framework/useToolRun.ts", import.meta.url), "utf8");

  expect((source.match(/new Worker\(/g) ?? []).length > 0).toBeTruthy();
  expect(source).not.toMatch(/type:\s*["']module["']/);
});

test("worker teardown invalidates async continuations before releasing resources", async () => {
  const source = await readFile(new URL("../lib/tool-framework/useToolRun.ts", import.meta.url), "utf8");
  const dispatch = source.indexOf("const dispatch = useCallback(");
  const terminate = source.indexOf("terminate();", dispatch);
  const spawn = source.indexOf("new Worker(", dispatch);
  const guard = source.indexOf("if (workerRef.current !== worker", dispatch);

  expect(dispatch >= 0).toBeTruthy();
  // The previous worker is killed before a new one can post into the same state.
  expect(terminate > dispatch && terminate < spawn).toBeTruthy();
  // A message from a worker that is no longer current never reaches the reducer.
  expect(guard > spawn).toBeTruthy();
  expect(source.indexOf("reduceWorkerJobState(", guard) > guard).toBeTruthy();
  // Unmount asks a persistent inspection to close, with forced teardown as a
  // watchdog; ordinary run workers still terminate immediately.
  expect(source).toMatch(/postMessage\(createToolInspectionCloseRequest\(jobId\)\)/);
  expect(source).toMatch(/setTimeout\(\(\) => currentWorker\.terminate\(\)/);
  expect(source).toMatch(/cleanupJob\(jobId\);/);
  expect(source).toMatch(/workerRef\.current\?\.terminate\(\);/);
});

/**
 * The numeric encoder tables moved into the tool that owns them, as private
 * module constants in `tools/<key>/run.worker.ts` — a tool's quality curve is
 * nobody else's business. They are asserted from source rather than imported so
 * that nothing has to be exported purely for a test.
 */
test("preset mappings preserve the product defaults and engine values", async () => {
  const compressImage = await toolSource("compress-image", "run.worker.ts");
  expect(compressImage).toMatch(/preset === "best"\s*\?\s*0\.9\s*:\s*preset === "smallest"\s*\?\s*0\.6\s*:\s*0\.8/);
  expect(compressImage).toMatch(
    /PNG_COMPRESSION_PRESETS = \{\s*fast: \{ effort: 3 \},\s*balanced: \{ effort: 6 \},\s*maximum: \{ effort: 9 \},\s*\}/,
  );
  expect(compressImage).not.toMatch(/PNG_COMPRESSION_PRESETS = \{[^}]*\{[^}]*quality/);

  const imageToPdf = await toolSource("image-to-pdf", "run.worker.ts");
  expect(imageToPdf).toMatch(
    /original: \{ quality: 1, reencode: false \},\s*balanced: \{ quality: 0\.82, reencode: true \},\s*small: \{ quality: 0\.65, reencode: true \},/,
  );

  const compressPdf = await toolSource("compress-pdf", "run.worker.ts");
  expect(compressPdf).toMatch(
    /high: \{ dpi: 150, quality: 0\.85 \},\s*balanced: \{ dpi: 120, quality: 0\.75 \},\s*smallest: \{ dpi: 96, quality: 0\.6 \},/,
  );

  // The choices and defaults each tool publishes are the definition's job.
  expect(mediaToolByFolder.get("compress-image").settings.fields.preset.choices.map(({ value }) => value)).toEqual([
    "best",
    "balanced",
    "smallest",
    "fast",
    "maximum",
  ]);
  expect(mediaToolByFolder.get("compress-image").settings.fields.preset.default).toBe("balanced");
  expect(mediaToolByFolder.get("image-to-pdf").settings.fields.quality.choices.map(({ value }) => value)).toEqual([
    "original",
    "balanced",
    "small",
  ]);
  expect(mediaToolByFolder.get("compress-pdf").settings.fields.strongPreset.choices.map(({ value }) => value)).toEqual([
    "high",
    "balanced",
    "smallest",
  ]);
  expect(mediaToolByFolder.get("compress-pdf").settings.fields.strongPreset.default).toBe("balanced");
});

test("social image presets map every published target to exact dimensions", async () => {
  const EXPECTED = {
    "instagram-square": ["Instagram square", 1080, 1080],
    "instagram-portrait": ["Instagram portrait", 1080, 1350],
    "story-reel": ["Story / Reel", 1080, 1920],
    "youtube-thumbnail": ["YouTube thumbnail", 1280, 720],
    "x-landscape": ["X landscape", 1600, 900],
    "linkedin-landscape": ["LinkedIn landscape", 1200, 627],
    "facebook-landscape": ["Facebook landscape", 1200, 630],
  };

  // What the picker offers, and the size each option promises the user.
  const { choices, default: fallback } = mediaToolByFolder.get("social-media-image-resizer").settings.fields.preset;
  expect(Object.fromEntries(choices.map(({ value, label }) => [value, label]))).toEqual(
    Object.fromEntries(
      Object.entries(EXPECTED).map(([value, [label, width, height]]) => [value, `${label} · ${width} × ${height}`]),
    ),
  );
  expect(fallback).toBe("instagram-square");

  // What the encoder actually resizes to, which must agree with the promise.
  const source = await toolSource("social-media-image-resizer", "run.worker.ts");
  for (const [value, [label, width, height]] of Object.entries(EXPECTED)) {
    expect(source, value).toMatch(
      new RegExp(
        `"${value}": \\{\\s*label: "${label.replaceAll("/", "\\/")}",\\s*width: ${width},\\s*height: ${height},?\\s*\\}`,
      ),
    );
  }
  expect((source.match(/^\s{2}"[a-z-]+": \{/gm) ?? []).length).toBe(Object.keys(EXPECTED).length);
});

test("media signatures are detected from bytes rather than extensions", () => {
  const fixtures = {
    pdf: new TextEncoder().encode("%PDF-1.7\n"),
    jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
    png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    webp: riff("VP8 ", Uint8Array.of(0)),
    heic: ftyp("heic", ["mif1", "heic"]),
  };

  for (const [kind, bytes] of Object.entries(fixtures)) {
    expect(detectMediaKind(bytes)).toBe(kind);
  }
  expect(detectMediaKind(new TextEncoder().encode("photo.jpg"))).toBe(null);
});

test("signature validation rejects MIME mismatches and unsupported animation", () => {
  expect(validateMediaSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/png")).toEqual({
    ok: false,
    code: "mime-mismatch",
    message: "The file contents do not match its reported type.",
    details: { messageRef: { key: "media.validateMediaSignature.mimeMismatch" } },
  });
  expect(validateMediaSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", ["png"]).code).toBe(
    "unsupported-type",
  );
  expect(validateMediaSignature(riff("VP8X", Uint8Array.of(0x02)), "image/webp").code).toBe("animated-image");
  expect(validateMediaSignature(ftyp("hevc", ["msf1"]), "image/heic").code).toBe("image-sequence");
  expect(validateMediaSignature(ftyp("heic", ["mif1"]), "")).toEqual({
    ok: true,
    kind: "heic",
    mime: "image/heic",
  });
  expect(validateMediaSignature(Uint8Array.of(1, 2, 3), "image/jpeg").code).toBe("invalid-signature");
});

test("image limits enforce per-file, batch, total, and decoded-pixel ceilings", () => {
  expect(validateImageSelection(Array.from({ length: MEDIA_LIMITS.images.maxFiles }, () => ({ size: 1 })))).toEqual({
    ok: true,
  });
  expect(validateImageSelection([{ size: MEDIA_LIMITS.images.maxFileBytes + 1 }]).code).toBe("file-too-large");
  expect(
    validateImageSelection(Array.from({ length: MEDIA_LIMITS.images.maxFiles + 1 }, () => ({ size: 1 }))).code,
  ).toBe("too-many-files");
  expect(validateImageSelection([{ size: 200 * 1024 * 1024 }, { size: 51 * 1024 * 1024 }]).code).toBe("file-too-large");
  expect(validateImageSelection(Array.from({ length: 11 }, () => ({ size: 24 * 1024 * 1024 }))).code).toBe(
    "total-too-large",
  );
  expect(validateDecodedImageDimensions(10_000, 10_000)).toEqual({ ok: true });
  expect(validateDecodedImageDimensions(10_001, 10_000).code).toBe("too-many-pixels");
  expect(validateDecodedImageDimensions(0, 10).code).toBe("invalid-dimensions");
});

test("PDF limits distinguish merge, structural, and raster jobs", () => {
  expect(
    validatePdfSelection([{ size: MEDIA_LIMITS.pdfs.maxFileBytes }], {
      pageCount: MEDIA_LIMITS.pdfs.maxStructuralPages,
    }),
  ).toEqual({ ok: true });
  expect(validatePdfSelection([{ size: MEDIA_LIMITS.pdfs.maxFileBytes + 1 }]).code).toBe("file-too-large");
  expect(
    validatePdfSelection(
      Array.from({ length: MEDIA_LIMITS.pdfs.maxMergeFiles + 1 }, () => ({
        size: 1,
      })),
      { merge: true },
    ).code,
  ).toBe("too-many-files");
  expect(
    validatePdfSelection(
      Array.from({ length: 20 }, () => ({ size: 13 * 1024 * 1024 })),
      { merge: true },
    ).code,
  ).toBe("total-too-large");
  expect(validatePdfSelection([{ size: 1 }], { pageCount: 501 }).code).toBe("too-many-pages");
  expect(validatePdfSelection([{ size: 1 }], { pageCount: 201, raster: true }).code).toBe("too-many-pages");
});

test("digitally signed PDFs are detected before a rewriting operation", () => {
  expect(hasPdfDigitalSignature(new TextEncoder().encode("%PDF-1.7\n/Type /Sig /ByteRange [0 10 20 30]"))).toBe(true);
  expect(hasPdfDigitalSignature(new TextEncoder().encode("%PDF-1.7\n/Pages 2 0 R"))).toBe(false);
});

test("qpdf preserve arguments toggle metadata removal without changing compression", () => {
  const base = [
    "/input.pdf",
    "--object-streams=generate",
    "--stream-data=compress",
    "--recompress-flate",
    "--compression-level=9",
  ];
  expect(buildQpdfArguments("/input.pdf", "/output.pdf", false)).toEqual([...base, "/output.pdf"]);
  expect(buildQpdfArguments("/input.pdf", "/output.pdf", true)).toEqual([
    ...base,
    "--remove-info",
    "--remove-metadata",
    "/output.pdf",
  ]);
});

test("qpdf preserve fails closed outside a cross-origin-isolated browser", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crossOriginIsolated");
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    configurable: true,
    value: false,
  });
  try {
    await assertRejects(
      preservePdfWithQpdf(new ArrayBuffer(0), {
        jobId: "unit-test",
        removeMetadata: true,
      }),
      (error) =>
        error instanceof QpdfAdapterError &&
        error.code === "qpdf-unavailable" &&
        /cross-origin-isolated browser/.test(error.message),
    );
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "crossOriginIsolated", previous);
    } else {
      delete globalThis.crossOriginIsolated;
    }
  }

  const failure = new QpdfAdapterError("qpdf-failed", "qpdf failed safely");
  expect(failure.code).toBe("qpdf-failed");
  expect(failure.message).toBe("qpdf failed safely");
});

test("image-to-PDF detects PNG alpha that must be flattened onto the selected background", () => {
  expect(hasTransparentPixels(Uint8ClampedArray.from([20, 30, 40, 255, 50, 60, 70, 255]))).toBe(false);
  expect(hasTransparentPixels(Uint8ClampedArray.from([20, 30, 40, 255, 50, 60, 70, 64]))).toBe(true);
});

test("PDF fill and cover clip exactly to the inner page box", () => {
  const pdfLib = requireFromMedia("pdf-lib");
  const box = getPdfContentBox(612, 792, 18);
  expect(box).toEqual({ x: 18, y: 18, width: 576, height: 756 });
  expect(clipStartOperators(box, pdfLib).map(String)).toEqual(["q", "18 18 576 756 re", "W", "n"]);
  expect(clipEndOperators(pdfLib).map(String)).toEqual(["Q"]);
});

test("Preserve Document preflight rejects encrypted and oversized structural PDFs", async () => {
  assertThrows(
    () => assertStructuralPdfInspection({ isEncrypted: true, pageCount: 1 }),
    (error) => error instanceof PdfPreflightError && error.code === "encrypted-pdf",
  );
  assertThrows(
    () => assertStructuralPdfInspection({ isEncrypted: false, pageCount: 501 }),
    (error) => error instanceof PdfPreflightError && error.code === "too-many-pages",
  );

  const { PDFDocument } = requireFromMedia("pdf-lib");
  const source = await PDFDocument.create();
  source.addPage([200, 300]);
  const bytes = await source.save();
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  expect(await inspectPdfBeforeStructuralRewrite(data)).toEqual({ pageCount: 1 });
  await assertRejects(
    inspectPdfBeforeStructuralRewrite(new TextEncoder().encode("%PDF-broken").buffer),
    (error) => error instanceof PdfPreflightError && error.code === "malformed-pdf",
  );
});

test("structural page processing reports start and completion for every page", async () => {
  const updates = [];
  const visited = [];
  await processStructuralPages(
    [3, 0],
    (page) => page + 1,
    "Resizing PDF page",
    (current, completed, total, stage) => {
      updates.push({ current, completed, total, stage });
    },
    async (page) => {
      visited.push(page);
    },
  );

  expect(visited).toEqual([3, 0]);
  expect(updates).toEqual([
    { current: 4, completed: 0, total: 2, stage: "Resizing PDF page" },
    { current: 4, completed: 1, total: 2, stage: "Page complete" },
    { current: 1, completed: 1, total: 2, stage: "Resizing PDF page" },
    { current: 1, completed: 2, total: 2, stage: "Page complete" },
  ]);
});

test("output names remove paths, controls, reserved names, and unsafe punctuation", () => {
  expect(sanitizeBaseName("../CON")).toBe("download");
  expect(sanitizeBaseName("  report:*?\u0000  ")).toBe("report");
  expect(sanitizeBaseName("Résumé 2026")).toBe("Résumé 2026");
  expect(sanitizeBaseName("...")).toBe("download");
  expect(sanitizeFileName("../quarterly:report.PDF")).toBe("quarterly-report.PDF");
  expect(createOutputFilename("../../invoice.final.JPG", "png")).toBe("invoice.final.png");
  expect(createOutputFilename("CON.pdf", ".pdf", "compressed")).toBe("download-compressed.pdf");
  expect(createPageOutputFilename("report.pdf", 3, 120, "jpg")).toBe("report-page-003.jpg");
  expect(createPageArchiveFilename("report.pdf")).toBe("report-pages.zip");
});

test("page ranges expand in display order and reject ambiguous selections", () => {
  expect(parsePageRange("1-3, 5, 8", 8)).toEqual({
    ok: true,
    pages: [1, 2, 3, 5, 8],
  });
  expect(parsePageRange("all", 3)).toEqual({ ok: true, pages: [1, 2, 3] });

  for (const [input, code] of [
    ["", "empty-range"],
    ["0", "page-out-of-range"],
    ["9", "page-out-of-range"],
    ["3-1", "reversed-range"],
    ["1,,2", "invalid-range"],
    ["1-3,3", "duplicate-page"],
    ["one", "invalid-range"],
  ]) {
    expect(parsePageRange(input, 8).code, input).toBe(code);
  }
});

test("resize and fit geometry covers aspect lock, no-upscale, contain, cover, and stretch", () => {
  expect(
    calculateResizeDimensions({ width: 400, height: 200 }, { width: 100, lockAspectRatio: true, noUpscale: true }),
  ).toEqual({ width: 100, height: 50 });
  expect(
    calculateResizeDimensions({ width: 400, height: 200 }, { percentage: 50, lockAspectRatio: true, noUpscale: true }),
  ).toEqual({ width: 200, height: 100 });
  expect(
    calculateResizeDimensions({ width: 400, height: 200 }, { width: 800, lockAspectRatio: true, noUpscale: true }),
  ).toEqual({ width: 400, height: 200 });
  expect(
    calculateResizeDimensions(
      { width: 400, height: 200 },
      { width: 100, height: 100, lockAspectRatio: false, noUpscale: false },
    ),
  ).toEqual({ width: 100, height: 100 });
  expect(fitRect({ width: 400, height: 200 }, { width: 100, height: 100 }, "contain")).toEqual({
    x: 0,
    y: 25,
    width: 100,
    height: 50,
    scaleX: 0.25,
    scaleY: 0.25,
  });
  expect(fitRect({ width: 400, height: 200 }, { width: 100, height: 100 }, "cover")).toEqual({
    x: -50,
    y: 0,
    width: 200,
    height: 100,
    scaleX: 0.5,
    scaleY: 0.5,
  });
  expect(fitRect({ width: 400, height: 200 }, { width: 100, height: 100 }, "stretch")).toEqual({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    scaleX: 0.25,
    scaleY: 0.5,
  });
});

test("geometry handles no-op, height-only, upscale, and invalid requests", () => {
  expect(calculateResizeDimensions({ width: 400, height: 200 }, { lockAspectRatio: true, noUpscale: true })).toEqual({
    width: 400,
    height: 200,
  });
  expect(
    calculateResizeDimensions({ width: 400, height: 200 }, { height: 50, lockAspectRatio: true, noUpscale: false }),
  ).toEqual({ width: 100, height: 50 });
  expect(
    calculateResizeDimensions(
      { width: 400, height: 200 },
      { percentage: 200, lockAspectRatio: true, noUpscale: false },
    ),
  ).toEqual({ width: 800, height: 400 });
  expect(calculateResizeDimensions({ width: 400, height: 200 }, { lockAspectRatio: false, noUpscale: false })).toEqual({
    width: 400,
    height: 200,
  });
  assertThrows(
    () =>
      calculateResizeDimensions({ width: 400, height: 200 }, { percentage: 0, lockAspectRatio: true, noUpscale: true }),
    /positive dimensions/,
  );
  assertThrows(() => fitRect({ width: 1, height: 1 }, { width: 1, height: 1 }, "tile"), /Unknown fit mode/);
  assertThrows(() => rotatedDimensions(10, 20, 45), /Rotation must be/);
});

test("crop, rotation, and EXIF orientation helpers keep pixels in bounds", () => {
  expect(normalizeCropRect({ x: -10, y: 10, width: 150, height: 100 }, { width: 100, height: 80 })).toEqual({
    x: 0,
    y: 10,
    width: 100,
    height: 70,
  });
  assertThrows(
    () => normalizeCropRect({ x: 0, y: 0, width: 0, height: 10 }, { width: 100, height: 80 }),
    /positive dimensions/,
  );
  expect(rotatedDimensions(400, 200, 90)).toEqual({ width: 200, height: 400 });
  expect(rotatedDimensions(400, 200, 180)).toEqual({ width: 400, height: 200 });
  expect(rotatedDimensions(400, 200, 270)).toEqual({ width: 200, height: 400 });

  expect(getExifOrientationTransform(6, 400, 200)).toEqual({
    matrix: [0, 1, -1, 0, 200, 0],
    width: 200,
    height: 400,
  });
  expect(getExifOrientationTransform(2, 400, 200)).toEqual({
    matrix: [-1, 0, 0, 1, 400, 0],
    width: 400,
    height: 200,
  });
  expect(readExifOrientation(jpegWithExifOrientation(8))).toBe(8);
  expect(readExifOrientation(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toBe(1);
  expect(readExifOrientation(Uint8Array.of())).toBe(1);
  expect(getExifOrientationTransform(99, 400, 200)).toEqual({
    matrix: [1, 0, 0, 1, 0, 0],
    width: 400,
    height: 200,
  });
  expect(normalizeCropRect({ x: 10, y: 20, width: 30, height: 40 }, { width: 100, height: 100 })).toEqual({
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  assertThrows(
    () => normalizeCropRect({ x: Number.NaN, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }),
    /Coordinates must be finite/,
  );
});

test("worker runs keep the original File with sanitized metadata", () => {
  const source = new File([Uint8Array.of(1, 2, 3)], "../private/photo?.jpg", {
    type: "IMAGE/JPEG",
  });
  const input = createToolRunFile("file-1", source);
  const message = createToolWorkerRequest({
    jobId: " job-1 ",
    key: " jpg-to-png ",
    files: [input],
    settings: {},
  });

  expect(message.files[0].source).toBe(source);
  expect(message.files[0].name).toBe("photo.jpg");
  expect(message.files[0].mime).toBe("image/jpeg");
  expect(message.files[0].size).toBe(3);
  expect({ type: message.type, jobId: message.jobId, key: message.key }).toEqual({
    type: "run",
    jobId: "job-1",
    key: "jpg-to-png",
  });
  expect(isToolWorkerMessage(message)).toBe(true);
});

test("worker protocol rejects malformed File-backed runs", () => {
  const source = new File([Uint8Array.of(1)], "photo.jpg", { type: "image/jpeg" });
  const file = createToolRunFile("file-1", source);

  assertThrows(() => createToolRunFile(" ", source), /ID/);
  assertThrows(() => createToolRunFile("file", new Blob([Uint8Array.of(1)])), /File/);
  assertThrows(() => createToolRunFile("file", new File(["x"], "bad.txt", { type: "not a mime" })), /MIME/);
  assertThrows(
    () =>
      createToolWorkerRequest({
        jobId: " ",
        key: "jpg-to-png",
        files: [file],
        settings: {},
      }),
    /job ID/,
  );
  assertThrows(
    () =>
      createToolWorkerRequest({
        jobId: "job",
        key: "  ",
        files: [file],
        settings: {},
      }),
    /tool key/,
  );
  assertThrows(() => beginWorkerJob(createToolJobState(), " "), /job ID/);

  // Untrusted structured-clone payloads are shape-checked in both directions.
  expect(isToolWorkerMessage({ type: "run", jobId: "job" })).toBe(false);
  expect(isToolWorkerMessage({ type: "cancel", jobId: "" })).toBe(false);
  expect(isToolWorkerMessage({ type: "cancel", jobId: "job" })).toBe(true);
  expect(isToolWorkerResponse({ type: "canceled", jobId: "job" })).toBe(true);
  expect(isToolWorkerResponse({ type: "success", jobId: "job" })).toBe(false);
  expect(
    isToolWorkerResponse({
      type: "success",
      jobId: "job",
      result: { render: "files" },
    }),
  ).toBe(true);
});

test("page inspection requests keep one document and a positive thumbnail width", () => {
  const file = createToolRunFile("pdf-1", new File([new ArrayBuffer(8)], "document.pdf", { type: "application/pdf" }));
  expect(createToolInspectRequest({ jobId: " inspect-1 ", key: "crop-pdf", file })).toEqual({
    type: "inspect",
    jobId: "inspect-1",
    key: "crop-pdf",
    files: [file],
    thumbnailWidth: INSPECT_THUMBNAIL_WIDTH,
  });
  expect(
    createToolInspectRequest({
      jobId: "inspect-1",
      key: "crop-pdf",
      file,
      thumbnailWidth: 160,
    }).thumbnailWidth,
  ).toBe(160);
  assertThrows(() => createToolInspectRequest({ jobId: "", key: "crop-pdf", file }), /job ID/);
  assertThrows(
    () =>
      createToolInspectRequest({
        jobId: "inspect",
        key: "crop-pdf",
        file,
        thumbnailWidth: 0,
      }),
    /positive integer/,
  );

  // Exactly one document per inspection — page geometry belongs to one file.
  expect(
    isToolWorkerMessage({
      type: "inspect",
      jobId: "j",
      key: "crop-pdf",
      files: [file, file],
      thumbnailWidth: 180,
    }),
  ).toBe(false);

  expect(
    createToolThumbnailRequest({
      jobId: " inspect-1 ",
      pageNumbers: [3, 1, 3, 2],
    }),
  ).toEqual({
    type: "inspect-thumbnails",
    jobId: "inspect-1",
    pageNumbers: [3, 1, 2],
  });
  expect(createToolInspectionCloseRequest(" inspect-1 ")).toEqual({
    type: "inspect-close",
    jobId: "inspect-1",
  });
  assertThrows(() => createToolThumbnailRequest({ jobId: "inspect-1", pageNumbers: [0] }), /positive integers/);
  assertThrows(
    () =>
      createToolThumbnailRequest({
        jobId: "inspect-1",
        pageNumbers: Array.from({ length: 25 }, (_, index) => index + 1),
      }),
    /24/,
  );
  expect(
    isToolWorkerMessage({
      type: "inspect-thumbnails",
      jobId: "inspect-1",
      pageNumbers: [1, 2],
    }),
  ).toBe(true);
  expect(
    isToolWorkerMessage({
      type: "inspect-thumbnails",
      jobId: "inspect-1",
      pageNumbers: [1, 1],
    }),
  ).toBe(false);
});

test("PDF inspection can target generated output and rejects unknown sources", () => {
  const file = createToolRunFile("generated-pdf", new File(["%PDF-1.7"], "images.pdf", { type: "application/pdf" }));
  const request = createToolInspectRequest({
    jobId: "output-preview",
    key: "image-to-pdf",
    file,
    source: "output",
  });
  expect(request.source).toBe("output");
  expect(request.key).toBe("image-to-pdf");
  expect(isToolWorkerMessage(request)).toBe(true);
  expect(isToolWorkerMessage({ ...request, source: undefined })).toBe(true);
  for (const source of ["other", null, false, 1]) {
    expect(isToolWorkerMessage({ ...request, source })).toBe(false);
  }
});

test("display preview requests validate pixel width and accept lossless PNG responses", () => {
  const input = { jobId: "preview", pageNumbers: [1], renderWidth: 2048 };
  expect(createToolThumbnailRequest(input).renderWidth).toBe(2048);
  expect(isToolWorkerMessage({ type: "inspect-thumbnails", ...input })).toBe(true);
  for (const renderWidth of [0, -1, 1.5, Infinity, 4097]) {
    assertThrows(() => createToolThumbnailRequest({ ...input, renderWidth }), /Preview width/);
    expect(isToolWorkerMessage({ type: "inspect-thumbnails", ...input, renderWidth })).toBe(false);
  }
  expect(
    isToolWorkerResponse({
      type: "thumbnails",
      jobId: "preview",
      previews: [
        {
          pageNumber: 1,
          pageWidth: 612,
          pageHeight: 792,
          width: 2048,
          height: 2650,
          renderWidth: 2048,
          mime: "image/png",
          buffer: new ArrayBuffer(1),
        },
      ],
    }),
  ).toBe(true);
});

test("large PDF previews evict raster bytes by pixel budget while preserving all page geometry", () => {
  let state = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "preview"), {
    type: "inspected",
    jobId: "preview",
    pageCount: 6,
    previews: Array.from({ length: 6 }, (_, index) => ({
      pageNumber: index + 1,
      pageWidth: 200,
      pageHeight: 400,
    })),
  });
  for (let pageNumber = 1; pageNumber <= 6; pageNumber++) {
    state = reduceWorkerJobState(state, {
      type: "thumbnails",
      jobId: "preview",
      previews: [
        {
          pageNumber,
          pageWidth: 200,
          pageHeight: 400,
          width: 2000,
          height: 4000,
          renderWidth: 2000,
          mime: "image/png",
          buffer: new ArrayBuffer(1),
        },
      ],
    });
  }
  expect(state.previews.length).toBe(6);
  expect(state.previews.filter((page) => page.buffer).map((page) => page.pageNumber)).toEqual([3, 4, 5, 6]);
  expect("renderWidth" in state.previews[0], "Evicted pages must be eligible to render again.").toBe(false);
});

test("worker job state ignores stale responses and cannot complete after cancellation", () => {
  const idle = createToolJobState();
  const started = beginWorkerJob(idle, "job-1");
  expect(idle, "beginWorkerJob must not mutate").toEqual(createToolJobState());
  expect({ status: started.status, jobId: started.jobId }).toEqual({ status: "running", jobId: "job-1" });

  // A response addressed to another job never advances the running job.
  const stale = reduceWorkerJobState(started, {
    type: "progress",
    jobId: "other-job",
    completed: 9,
    total: 9,
    stage: "encode",
  });
  expect(stale).toBe(started);
  expect(stale.progress).toBe(null);

  const progressed = reduceWorkerJobState(started, {
    type: "progress",
    jobId: "job-1",
    completed: 1,
    total: 4,
    stage: "decode",
  });
  expect(progressed.progress).toEqual({
    completed: 1,
    total: 4,
    stage: "decode",
  });
  expect(started.progress, "reduce must not mutate its input").toBe(null);

  const canceled = cancelWorkerJob(progressed);
  expect(canceled.message).toEqual({ type: "cancel", jobId: "job-1" });
  expect(canceled.state.status).toBe("canceled");
  expect(canceled.state.progress).toBe(null);
  expect(progressed.status, "cancel must not mutate its input").toBe("running");

  // Terminal states are frozen: a late success for the same job changes nothing.
  expect(
    reduceWorkerJobState(canceled.state, {
      type: "success",
      jobId: "job-1",
      result: { render: "files", files: [] },
    }),
  ).toBe(canceled.state);
  // Only a running job can be cancelled.
  expect(cancelWorkerJob(createToolJobState())).toBe(null);
  expect(cancelWorkerJob(canceled.state)).toBe(null);
  // And an idle state ignores every response.
  expect(
    reduceWorkerJobState(idle, {
      type: "progress",
      jobId: "job-1",
      completed: 1,
      total: 2,
      stage: "decode",
    }),
  ).toBe(idle);
});

test("thumbnail failures surface after inspection while completed conversions stay frozen", () => {
  const started = beginWorkerJob(createToolJobState(), "preview-job");
  const inspected = reduceWorkerJobState(started, {
    type: "inspected",
    jobId: "preview-job",
    pageCount: 1,
    previews: [{ pageNumber: 1, pageWidth: 612, pageHeight: 792 }],
  });
  const failure = {
    type: "failure",
    jobId: "preview-job",
    code: "render-failed",
    message: "The page could not be rendered.",
    recovery: "Retry the preview.",
  };
  const failed = reduceWorkerJobState(inspected, failure);
  expect(failed.status).toBe("failed");
  expect(failed.error.message).toBe(failure.message);
  expect(failed.error.recovery).toBe(failure.recovery);
  expect(reduceWorkerJobState(inspected, { ...failure, jobId: "old-job" })).toBe(inspected);
  expect(
    reduceWorkerJobState(failed, {
      type: "thumbnails",
      jobId: "preview-job",
      previews: [],
    }),
  ).toBe(failed);
  const converted = reduceWorkerJobState(started, {
    type: "success",
    jobId: "preview-job",
    result: { render: "files", files: [] },
  });
  expect(reduceWorkerJobState(converted, failure)).toBe(converted);
});

test("worker failures, cancellations, and successes produce frozen terminal state", () => {
  const failed = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "job-2"), {
    type: "failure",
    jobId: "job-2",
    code: "memory-limit",
    message: "This file needs more memory than the browser can provide.",
    recovery: "Try a smaller file.",
  });
  expect(failed.status).toBe("failed");
  expect(failed.progress).toBe(null);
  expect(failed.error).toEqual({
    code: "memory-limit",
    message: "This file needs more memory than the browser can provide.",
    recovery: "Try a smaller file.",
  });
  expect(
    reduceWorkerJobState(failed, {
      type: "success",
      jobId: "job-2",
      result: { render: "text", text: "too late" },
    }),
  ).toBe(failed);

  const result = {
    render: "files",
    files: [
      {
        storage: "blob",
        blob: new Blob([Uint8Array.of(1, 2)], { type: "application/pdf" }),
        createdAt: 1,
        id: "artifact-1",
        jobId: "job-3",
        mime: "application/pdf",
        name: "merged.pdf",
        size: 2,
      },
    ],
  };
  const complete = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "job-3"), {
    type: "success",
    jobId: "job-3",
    result,
  });
  expect(complete.status).toBe("completed");
  expect(complete.progress).toBe(null);
  expect(complete.result).toEqual(result);

  const inspected = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "job-4"), {
    type: "inspected",
    jobId: "job-4",
    pageCount: 2,
    previews: [
      { pageNumber: 1, pageWidth: 612, pageHeight: 792 },
      { pageNumber: 2, pageWidth: 612, pageHeight: 792 },
    ],
  });
  expect(inspected.status).toBe("completed");
  expect(inspected.pageCount).toBe(2);
  expect(inspected.previews.length).toBe(2);

  const thumbnail = {
    pageNumber: 2,
    pageWidth: 612,
    pageHeight: 792,
    width: 139,
    height: 180,
    buffer: new ArrayBuffer(8),
    mime: "image/jpeg",
  };
  const withThumbnail = reduceWorkerJobState(inspected, {
    type: "thumbnails",
    jobId: "job-4",
    previews: [thumbnail],
  });
  expect(withThumbnail.status).toBe("completed");
  expect(withThumbnail.previews.length).toBe(2);
  expect(withThumbnail.previews[0].pageNumber).toBe(1);
  expect(withThumbnail.previews[1].buffer).toBe(thumbnail.buffer);
  expect(
    isToolWorkerResponse({
      type: "thumbnails",
      jobId: "job-4",
      previews: [{ pageNumber: 2, pageWidth: 612, pageHeight: 792 }],
    }),
  ).toBe(false);

  let cached = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "job-4"), {
    type: "inspected",
    jobId: "job-4",
    pageCount: 25,
    previews: Array.from({ length: 25 }, (_, index) => ({
      pageNumber: index + 1,
      pageWidth: 612,
      pageHeight: 792,
    })),
  });
  for (let pageNumber = 1; pageNumber <= 25; pageNumber += 1) {
    cached = reduceWorkerJobState(cached, {
      type: "thumbnails",
      jobId: "job-4",
      previews: [
        {
          pageNumber,
          pageWidth: 612,
          pageHeight: 792,
          width: 139,
          height: 180,
          buffer: new ArrayBuffer(1),
          mime: "image/jpeg",
        },
      ],
    });
  }
  expect(cached.previews.filter((preview) => "buffer" in preview).length).toBe(24);
  expect("buffer" in cached.previews[0]).toBe(false);

  const stopped = reduceWorkerJobState(beginWorkerJob(createToolJobState(), "job-5"), {
    type: "canceled",
    jobId: "job-5",
  });
  expect(stopped.status).toBe("canceled");
  expect(
    reduceWorkerJobState(stopped, {
      type: "success",
      jobId: "job-5",
      result: { render: "text", text: "too late" },
    }),
  ).toBe(stopped);
});

function riff(chunkType, payload) {
  const bytes = new Uint8Array(20 + payload.length + (payload.length % 2));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode(chunkType), 12);
  new DataView(bytes.buffer).setUint32(16, payload.length, true);
  bytes.set(payload, 20);
  return bytes;
}

function ftyp(majorBrand, compatibleBrands = []) {
  const bytes = new Uint8Array(16 + compatibleBrands.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(majorBrand), 8);
  bytes.set(new TextEncoder().encode("0000"), 12);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(new TextEncoder().encode(brand), 16 + index * 4);
  });
  return bytes;
}

function jpegWithExifOrientation(orientation) {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22], 0);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
  bytes.set([0x49, 0x49], 12);
  const view = new DataView(bytes.buffer);
  view.setUint16(14, 42, true);
  view.setUint32(16, 8, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 0x0112, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, orientation, true);
  view.setUint32(34, 0, true);
  bytes.set([0xff, 0xd9], 38);
  return bytes;
}
