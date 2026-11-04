/**
 * Moved verbatim from the `qr-code-generator` case in
 * `lib/devtools/format-json.ts`: the same `qrcode` package, the same
 * `toDataURL` + `toString({ type: "svg" })` pair, the same options, and the
 * same `qr-code.png` / `qr-code.svg` names.
 *
 * The import is dynamic so `qrcode` stays out of the initial bundle.
 */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly errorCorrection: string;
  readonly size: number;
  readonly margin: number;
  readonly dark: string;
  readonly light: string;
  readonly transparentBackground: boolean;
};

type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

const TRANSPARENT = "#00000000";

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const content = ctx.input.text;
  if (!content.trim()) {
    throw new ToolError(
      "input-required",
      "Text or URL is required.",
      "Enter the URL or text you want the QR code to encode.",
      { messageRef: { key: "errors.input-required" }, recoveryMessage: { key: "recovery.input-required" } },
    );
  }

  const { default: QRCode } = await import("qrcode");
  ctx.signal.throwIfAborted();

  const options = {
    width: ctx.settings.size,
    margin: ctx.settings.margin,
    errorCorrectionLevel: ctx.settings.errorCorrection as ErrorCorrectionLevel,
    color: {
      dark: ctx.settings.dark,
      light: ctx.settings.transparentBackground ? TRANSPARENT : ctx.settings.light,
    },
  };

  const src = await QRCode.toDataURL(content, options);
  const svg = await QRCode.toString(content, { ...options, type: "svg" });
  ctx.signal.throwIfAborted();

  return {
    render: "image",
    src,
    mime: "image/png",
    alt: `QR code encoding ${content}`,
    altMessage: { key: "qr.alt", values: { content } },
    width: ctx.settings.size,
    height: ctx.settings.size,
    downloadName: "qr-code.png",
    artifacts: [
      {
        storage: "inline",
        content: svg,
        mimeType: "image/svg+xml;charset=utf-8",
        name: "qr-code.svg",
      },
    ],
  };
};

export default run;
