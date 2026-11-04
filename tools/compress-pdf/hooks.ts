/**
 * Pre-run hooks, held to the same discipline as `definition.ts`: pure, React-
 * free, no heavy dependencies.
 *
 * They live here rather than beside `run` because `run.worker.ts` statically
 * imports `lib/tool-framework/media/pdfRender.ts`, the sole owner of
 * `pdfjs-dist`, which must never be reachable from a main-thread import graph.
 * Calling `validate` means importing the module it lives in, so a hook exported
 * from the run file would drag `pdfjs-dist` onto the main thread.
 */

import type { ToolValidate } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly mode: string;
  readonly removeMetadata: boolean;
  readonly strongPreset: string;
  readonly color: string;
  readonly confirmed: boolean;
};

/**
 * Replaces the `definition.slug === "compress-pdf"` guard at
 * `MediaWorkbench.tsx:806-813`, with the same message.
 */
export const validate: ToolValidate<Settings> = (settings) =>
  settings.mode === "strong" && settings.confirmed !== true
    ? {
        message: "Confirm the document-content loss before using Strong Compression.",
        messageRef: { key: "readiness.confirmContentLoss" },
      }
    : null;
