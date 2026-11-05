/**
 * Moved from `convertPdfToImages` in `app/media/_workers/pdf.worker.ts:133-189`,
 * plus the shared preflight from `processPdf` (`pdf.worker.ts:91-98`).
 *
 * `pdf.worker.ts:137-138,157` picked the extension, MIME, and quality from the
 * operation name so one handler could serve both `pdf-to-jpg` and `pdf-to-png`.
 * This tool states all three itself. Generated pages are stored individually
 * for preview/download, then streamed from storage into one ZIP.
 */

import { validatePdfInput } from "../../lib/tool-framework/media/pdfDocument.ts";
import { encodeCanvas, forEachRenderedPdfPage } from "../../lib/tool-framework/media/pdfRender.ts";
import {
  createPageArchiveFilename,
  createPageOutputFilename,
  validatePdfSelection,
} from "../../lib/tool-framework/media/validation.ts";
import { createArtifactBatchWriter, type ArtifactBatchWriter } from "../../lib/tool-framework/media/zip.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { PageSelection } from "../../lib/tool-framework/settings.ts";

type Settings = {
  readonly pages: PageSelection;
  readonly dpi: string;
  readonly quality: number;
};

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const input = ctx.input.files[0];
  const selection = validatePdfSelection(input ? [{ size: input.size }] : []);
  if (!selection.ok) throw new ToolError(selection.code, selection.message, undefined, selection.details);
  await validatePdfInput(input);

  const batchState: { current: ArtifactBatchWriter | null } = { current: null };
  try {
    await forEachRenderedPdfPage(
      {
        file: input,
        selection: ctx.settings.pages,
        dpi: Number(ctx.settings.dpi),
        background: "white",
        signal: ctx.signal,
        progress: ctx.progress,
      },
      async (page, index, total) => {
        batchState.current ??= await createArtifactBatchWriter(ctx, {
          archiveName: createPageArchiveFilename(input.name),
          count: total,
          retainEntries: true,
        });
        ctx.progress({
          completed: index,
          total,
          stage: "Encoding page",
          stageMessage: { key: "progress.encodingPage" },
        });
        const buffer = await encodeCanvas(page.canvas, "jpg", ctx.settings.quality / 100);
        await batchState.current.add({
          name: createPageOutputFilename(input.name, page.pageNumber, page.pageCount, "jpg"),
          mime: "image/jpeg",
          source: new Uint8Array(buffer),
        });
        ctx.progress({
          completed: index + 1,
          total,
          stage: "Page complete",
          stageMessage: { key: "progress.pageComplete" },
        });
      },
    );
  } catch (error) {
    await batchState.current?.abort(error);
    throw error;
  }
  const batch = batchState.current;
  if (!batch)
    throw new ToolError("empty-range", "Choose at least one PDF page.", undefined, {
      messageRef: { key: "errors.emptyRange" },
    });
  let files: Awaited<ReturnType<ArtifactBatchWriter["finish"]>>;
  try {
    ctx.progress({
      completed: 0,
      total: 1,
      stage: "Packaging images",
      stageMessage: { key: "progress.packagingImages" },
    });
    files = await batch.finish();
    ctx.progress({ completed: 1, total: 1, stage: "Images ready", stageMessage: { key: "progress.imagesReady" } });
  } catch (error) {
    await batch.abort(error);
    throw error;
  }

  return {
    render: "files",
    files,
    inputBytes: input.size,
    outputBytes: files[0].size,
  };
};

export default run;
