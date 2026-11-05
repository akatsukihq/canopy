/**
 * Moved from `splitPdf` in `app/media/_workers/pdf.worker.ts:219-269`, plus the
 * shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `buildJobOptions` used to split the `ranges` text on `;` and run each part
 * through `parsePageRange` before the job started (`MediaWorkbench.tsx:1626`,
 * `1702-1706`). The preview and execution now share `splitPageGroups`, which
 * validates ranges against the actual document before any outputs are written.
 */

import {
  addCopiedPagesWithProgress,
  checkedPages,
  enforcePageLimit,
  loadPdf,
  validatePdfInput,
} from "../../lib/tool-framework/media/pdfDocument.ts";
import { readArtifact, type StoredToolArtifact } from "../../lib/tool-framework/artifacts.ts";
import { createOutputFilename, validatePdfSelection } from "../../lib/tool-framework/media/validation.ts";
import { writeArtifactBatch } from "../../lib/tool-framework/media/zip.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { splitPageGroups } from "./groups.ts";

type Settings = {
  readonly mode: string;
  readonly interval: number;
  readonly ranges: string;
  readonly bundleAsZip: boolean;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files?.[0];
  if (!input)
    throw new ToolError("no-files", "Choose a PDF to split.", undefined, { messageRef: { key: "errors.noFiles" } });
  const selection = validatePdfSelection(ctx.input.files.map((file) => ({ size: file.size })));
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  for (const file of ctx.input.files) await validatePdfInput(file);

  const { PDFDocument } = await import("pdf-lib");
  const source = await loadPdf(input);
  const count = source.getPageCount();
  enforcePageLimit(input, count, false);
  const groups = splitPageGroups(ctx.settings, count);
  if (!groups.length)
    throw new ToolError("empty-range", "Choose at least one page range.", undefined, {
      messageRef: { key: "errors.emptyRange" },
    });

  const outputs: StoredToolArtifact[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    ctx.signal.throwIfAborted();
    const pages = checkedPages(groups[index], count);
    const document = await PDFDocument.create();
    await addCopiedPagesWithProgress(document, source, pages, "Creating split PDF", ctx.progress, {
      key: "progress.creatingSplitPdf",
    });
    outputs.push(
      await ctx.writeArtifact({
        name: createOutputFilename(input.name, "pdf", `part-${String(index + 1).padStart(2, "0")}`),
        mime: "application/pdf",
        source: await document.save(),
      }),
    );
  }

  let files: readonly StoredToolArtifact[] = outputs;
  if (ctx.settings.bundleAsZip) {
    const archive = await writeArtifactBatch(
      ctx,
      {
        archiveName: createOutputFilename(input.name, "zip", "split"),
        count: outputs.length,
        forceArchive: true,
      },
      async (add) => {
        for (const output of outputs) {
          ctx.signal.throwIfAborted();
          await add({
            name: output.name,
            mime: output.mime,
            source: await readArtifact(output),
          });
        }
      },
    );
    files = [...outputs, ...archive];
  }

  return {
    render: "files",
    files,
    inputBytes: input.size,
    outputBytes: files.reduce((sum, output) => sum + output.size, 0),
  };
};

export default run;
