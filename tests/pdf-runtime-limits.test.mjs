import { toolSpec } from "./helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import compressPdf from "../tools/compress-pdf/run.worker.ts";
const imageToPdf = await toolSpec("image-to-pdf");
import { run as createPdfFromImages } from "../tools/image-to-pdf/run.worker.ts";

const MIB = 1024 * 1024;

test("Image to PDF admits at most 50 MiB to its pdf-lib job", () => {
  expect(imageToPdf.input.maxTotalBytes).toBe(50 * MIB);
});

test("Image to PDF enforces its 50 MiB pdf-lib ceiling inside the worker", async () => {
  const files = [
    { id: "one", name: "one.jpg", mime: "image/jpeg", size: 25 * MIB, source: {} },
    { id: "two", name: "two.jpg", mime: "image/jpeg", size: 25 * MIB + 1, source: {} },
  ];

  await expect(
    createPdfFromImages({
      input: { text: "", files },
      settings: {},
      signal: new AbortController().signal,
      progress() {},
      async writeArtifact() {
        throw new Error("Image to PDF must not write an artifact.");
      },
    }),
  ).rejects.toSatisfy((error) => error?.code === "total-too-large" && /must total 50 MiB or less/.test(error.message));
});

test("Strong PDF Compression rejects input above its 50 MiB runtime ceiling", async () => {
  const signal = new AbortController().signal;
  const input = {
    id: "large-pdf",
    name: "large.pdf",
    mime: "application/pdf",
    size: 50 * MIB + 1,
    // The guard must reject by metadata before trying to read any bytes.
    source: {},
  };

  await expect(
    compressPdf({
      input: { text: "", files: [input] },
      settings: {
        mode: "strong",
        removeMetadata: true,
        strongPreset: "balanced",
        color: "original",
        confirmed: true,
      },
      signal,
      progress() {},
      async writeArtifact() {
        throw new Error("Strong compression must not write an artifact.");
      },
    }),
  ).rejects.toSatisfy(
    (error) => error?.code === "file-too-large" && /Strong Compression supports PDFs up to 50 MiB/.test(error.message),
  );
});
